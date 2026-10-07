import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
const root = fileURLToPath(new URL('../', import.meta.url))
const wrangler = join(root, 'apps/worker/node_modules/.bin/wrangler')
const mode = process.argv[2]
const options = Object.fromEntries(
  process.argv.slice(3).map((value) => {
    const index = value.indexOf('=')
    return [value.slice(0, index), value.slice(index + 1)]
  }),
)
const scratch = await mkdtemp(join(tmpdir(), 'accord-backup-'))
let lastOperation
function run(args) {
  lastOperation = args.filter((value) => value !== '--json').join(' ')
  return execFileSync(wrangler, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 32 * 1024 * 1024,
  })
}
function encrypt(sql, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('accord-backup-v1'))
  const data = Buffer.concat([cipher.update(gzipSync(sql)), cipher.final()])
  return JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  })
}
function decrypt(archive, key) {
  const value = JSON.parse(archive)
  if (value.version !== 1) throw new Error('Unsupported backup version')
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'))
  cipher.setAAD(Buffer.from('accord-backup-v1'))
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return gunzipSync(
    Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]),
  )
}
try {
  if (mode === 'drill') {
    // Synthetic databases only: no existing .wrangler state or remote credentials.
    const config = join(scratch, 'wrangler.json'),
      source = join(scratch, '.wrangler/state'),
      target = join(scratch, 'restore')
    await writeFile(
      config,
      JSON.stringify({
        name: 'accord-recovery-drill',
        compatibility_date: '2026-08-15',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'accord-drill',
            database_id: '11111111-1111-1111-1111-111111111111',
          },
        ],
      }),
    )
    const local = (state, ...args) =>
      run([
        'd1',
        ...args,
        '--config',
        config,
        '--local',
        ...(args[0] === 'export' ? [] : ['--persist-to', state]),
      ])
    const migrations = (await readdir(join(root, 'apps/worker/migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort()
    for (const migration of migrations)
      local(
        source,
        'execute',
        'accord-drill',
        '--file',
        join(root, 'apps/worker/migrations', migration),
      )
    const tokenKey = randomBytes(32),
      iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', tokenKey, iv)
    c.setAAD(Buffer.from('u:c:google'))
    const ciphertext = Buffer.concat([
      c.update(JSON.stringify({ accessToken: 'fixture-token' })),
      c.final(),
      c.getAuthTag(),
    ])
    const token = JSON.stringify({
      version: 'v1',
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    })
    const seed = `INSERT INTO user VALUES('u','Fixture','fixture@example.invalid',1,NULL,1,1);
INSERT INTO customers VALUES('u',123456,'cus_fixture','{"status":"active"}',0);
INSERT INTO connections VALUES('c','u','google','Fixture','external','connected','${token}',1);
INSERT INTO rules VALUES('r','u',1,'active','{"id":"r","status":"active"}');
INSERT INTO entity_links VALUES('u','r','group','task','event','{"baseline":{"title":"Fixture"}}');
INSERT INTO sync_cursors VALUES('u','r','source','fixture-cursor');
INSERT INTO operations VALUES('op','u','r','pending',1,0,'{"id":"op"}');
INSERT INTO activity VALUES('activity','u','r','task','done','Fixture','Fixture detail',1);
INSERT INTO trial_claims VALUES('fixture-hash',1);
INSERT INTO billing_events VALUES('evt','u','sub_fixture','pending',1);
INSERT INTO provider_secrets VALUES('notion','fixture-encrypted',1);`
    await writeFile(join(scratch, 'seed.sql'), seed)
    local(source, 'execute', 'accord-drill', '--file', join(scratch, 'seed.sql'))
    const exported = join(scratch, 'export.sql')
    local(source, 'export', 'accord-drill', '--output', exported)
    const sql = await readFile(exported),
      key = randomBytes(32),
      archive = encrypt(sql, key)
    const restoredSql = decrypt(archive, key)
    if (!sql.equals(restoredSql)) throw new Error('Archive roundtrip mismatch')
    let rejected = false
    try {
      decrypt(archive, randomBytes(32))
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Invalid backup key accepted')
    const tampered = JSON.parse(archive)
    const bytes = Buffer.from(tampered.data, 'base64')
    bytes[0] ^= 1
    tampered.data = bytes.toString('base64')
    rejected = false
    try {
      decrypt(JSON.stringify(tampered), key)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Tampered archive accepted')
    const restoreFile = join(scratch, 'restore.sql')
    await writeFile(restoreFile, restoredSql)
    local(target, 'execute', 'accord-drill', '--file', restoreFile)
    const tables = JSON.parse(
      local(
        source,
        'execute',
        'accord-drill',
        '--command',
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
        '--json',
      ),
    )[0].results.map((row) => row.name)
    const command = tables.map((table) => `SELECT * FROM "${table}" ORDER BY rowid;`).join('\n')
    const snapshot = (state) =>
      JSON.parse(local(state, 'execute', 'accord-drill', '--command', command, '--json')).map(
        (result) => result.results,
      )
    const before = snapshot(source),
      after = snapshot(target)
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('Restored database differs from export source')
    const row = JSON.parse(
      local(
        target,
        'execute',
        'accord-drill',
        '--command',
        "SELECT encrypted_tokens FROM connections WHERE id='c'",
        '--json',
      ),
    )[0].results[0]
    const restored = JSON.parse(row.encrypted_tokens),
      buffer = Buffer.from(restored.ciphertext, 'base64')
    const d = createDecipheriv('aes-256-gcm', tokenKey, Buffer.from(restored.iv, 'base64'))
    d.setAAD(Buffer.from('u:c:google'))
    d.setAuthTag(buffer.subarray(-16))
    const plain = Buffer.concat([d.update(buffer.subarray(0, -16)), d.final()])
    if (JSON.parse(plain).accessToken !== 'fixture-token') throw new Error('Token recovery failed')
    const sqliteFiles = []
    async function findSqlite(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await findSqlite(path)
        else if (entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite')
          sqliteFiles.push(path)
      }
    }
    await findSqlite(join(target, 'v3/d1'))
    if (sqliteFiles.length !== 1) throw new Error('Expected one restored D1 SQLite database')
    const integrity = execFileSync(
      'sqlite3',
      ['-readonly', sqliteFiles[0], 'PRAGMA integrity_check; PRAGMA foreign_key_check;'],
      { encoding: 'utf8' },
    ).trim()
    if (integrity !== 'ok') throw new Error('Restored SQLite integrity or foreign key check failed')
    const report = {
      date: new Date().toISOString(),
      mode: 'isolated-local-D1',
      migrations: migrations.length,
      tables: tables.length,
      rows: before.reduce((count, rows) => count + rows.length, 0),
      archiveSha256: createHash('sha256').update(archive).digest('hex'),
      checks: [
        'D1 export/import',
        'AES-GCM + gzip roundtrip',
        'incorrect key rejected',
        'tampering rejected',
        'all table rows identical',
        'provider token decrypted',
        'SQLite integrity',
        'foreign keys',
      ],
      remoteTested: false,
    }
    if (options['--report'])
      await writeFile(resolve(options['--report']), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  } else if (mode === 'export') {
    if (
      !options['--config'] ||
      !options['--database'] ||
      !options['--output'] ||
      !['local', 'remote'].includes(options['--source'])
    )
      throw new Error(
        'Usage: export --config=path --database=name --source=local|remote --output=archive.accord-backup [--state=local-state]',
      )
    const key = Buffer.from(process.env.ACCORD_BACKUP_KEY ?? '', 'base64')
    if (key.length !== 32) throw new Error('Set ACCORD_BACKUP_KEY to a separate 32-byte base64 key')
    const args = [
      'd1',
      'export',
      options['--database'],
      '--config',
      resolve(options['--config']),
      '--' + options['--source'],
      '--output',
      join(scratch, 'export.sql'),
    ]
    if (options['--source'] === 'local') {
      if (!options['--state']) throw new Error('Local export requires explicit --state')
      const supplied = JSON.parse(
        (await readFile(resolve(options['--config']), 'utf8')).replace(/,\s*([}\]])/g, '$1'),
      )
      const localConfig = join(scratch, 'local.json')
      await writeFile(
        localConfig,
        JSON.stringify({
          name: 'accord-local-export',
          compatibility_date: '2026-08-15',
          d1_databases: supplied.d1_databases,
        }),
      )
      await mkdir(join(scratch, '.wrangler'))
      await symlink(resolve(options['--state']), join(scratch, '.wrangler/state'))
      args[args.indexOf('--config') + 1] = localConfig
    }
    run(args)
    const archive = encrypt(await readFile(join(scratch, 'export.sql')), key)
    await writeFile(resolve(options['--output']), archive, { mode: 0o600, flag: 'wx' })
    console.log(
      'Encrypted archive created; SHA256 ' + createHash('sha256').update(archive).digest('hex'),
    )
  } else if (mode === 'decrypt') {
    if (!options['--input'] || !options['--output'])
      throw new Error('Usage: decrypt --input=archive --output=new.sql')
    const key = Buffer.from(process.env.ACCORD_BACKUP_KEY ?? '', 'base64')
    if (key.length !== 32) throw new Error('Invalid ACCORD_BACKUP_KEY')
    await writeFile(
      resolve(options['--output']),
      decrypt(await readFile(resolve(options['--input']), 'utf8'), key),
      { mode: 0o600, flag: 'wx' },
    )
    console.log('SQL decrypted into the requested protected file; no database changed.')
  } else
    throw new Error('Choose drill, export or decrypt. This tool never restores a remote database.')
} catch (error) {
  // Wrangler error text can contain SQL data; never echo it into shared logs.
  console.error(
    error.status !== undefined
      ? 'Wrangler command failed; inspect configuration locally.'
      : error.message,
  )
  if (mode === 'drill') {
    console.error(lastOperation)
    console.error(String(error.stderr || error.stdout || error.message))
  }
  process.exitCode = 1
} finally {
  await rm(scratch, { recursive: true, force: true })
}
