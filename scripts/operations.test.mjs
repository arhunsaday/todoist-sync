import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const values = {
  PUBLIC_URL: 'https://accord.example.invalid',
  D1_DATABASE_ID: '12345678-1234-1234-1234-123456789012',
  D1_DATABASE_NAME: 'accord-test',
  BETTER_AUTH_SECRET: 'fixture-auth-secret-32-characters',
  TOKEN_ENCRYPTION_KEY: Buffer.from('01234567890123456789012345678901').toString('base64'),
  GOOGLE_CLIENT_ID: 'google-fixture',
  GOOGLE_CLIENT_SECRET: 'secret-google',
  TODOIST_CLIENT_ID: 'todoist-fixture',
  TODOIST_CLIENT_SECRET: 'secret-todoist',
  NOTION_CLIENT_ID: 'notion-fixture',
  NOTION_CLIENT_SECRET: 'secret-notion',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_PRICE_ID: 'price_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'accord-setup-test-'))
  const worker = join(root, 'apps/worker')
  await mkdir(worker, { recursive: true })
  await writeFile(
    join(worker, 'wrangler.jsonc'),
    await readFile(new URL('../apps/worker/wrangler.jsonc', import.meta.url)),
  )
  try {
    await run(root, worker)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
async function generate(root, worker, input) {
  await writeFile(
    join(worker, '.dev.vars.production'),
    Object.entries(input)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  )
  return spawnSync(process.execPath, ['scripts/configure-production.mjs'], {
    env: { ...process.env, ACCORD_SETUP_ROOT: root },
    encoding: 'utf8',
  })
}
test('generates production bindings without bundling secrets or modifying local config', async () =>
  fixture(async (root, worker) => {
    const before = await readFile(join(worker, 'wrangler.jsonc'), 'utf8')
    const result = await generate(root, worker, values)
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(await readFile(join(worker, 'wrangler.production.json'), 'utf8'))
    assert.equal(config.vars.PUBLIC_URL, values.PUBLIC_URL)
    assert.equal(config.d1_databases[0].database_id, values.D1_DATABASE_ID)
    const publicFile = JSON.stringify(config)
    for (const key of [
      'BETTER_AUTH_SECRET',
      'TOKEN_ENCRYPTION_KEY',
      'GOOGLE_CLIENT_SECRET',
      'STRIPE_SECRET_KEY',
    ])
      assert.equal(publicFile.includes(values[key]), false)
    const upload = JSON.parse(await readFile(join(worker, '.dev.vars.upload.json'), 'utf8'))
    assert.equal(upload.STRIPE_SECRET_KEY, values.STRIPE_SECRET_KEY)
    assert.equal(upload.PUBLIC_URL, undefined)
    assert.equal((await stat(join(worker, '.dev.vars.upload.json'))).mode & 0o777, 0o600)
    assert.equal(await readFile(join(worker, 'wrangler.jsonc'), 'utf8'), before)
  }))
test('rejects insecure origin, placeholder D1 and live Stripe during preparation', async () =>
  fixture(async (root, worker) => {
    for (const changes of [
      { PUBLIC_URL: 'http://example.invalid' },
      { PUBLIC_URL: 'https://example.invalid/path' },
      { D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000' },
      { STRIPE_SECRET_KEY: 'sk_live_fixture' },
      { TOKEN_ENCRYPTION_KEY: 'invalid' },
      { STRIPE_PRICE_ID: 'prod_fixture' },
    ]) {
      const result = await generate(root, worker, { ...values, ...changes })
      assert.notEqual(result.status, 0)
      assert.equal(result.stdout.includes(values.GOOGLE_CLIENT_SECRET), false)
    }
  }))
test('uploads owner emails as a secret when set', async () =>
  fixture(async (root, worker) => {
    const result = await generate(root, worker, { ...values, OWNER_EMAILS: 'me@example.invalid' })
    assert.equal(result.status, 0, result.stderr)
    const upload = JSON.parse(await readFile(join(worker, '.dev.vars.upload.json'), 'utf8'))
    assert.equal(upload.OWNER_EMAILS, 'me@example.invalid')
    const config = await readFile(join(worker, 'wrangler.production.json'), 'utf8')
    assert.equal(config.includes('me@example.invalid'), false)
  }))
