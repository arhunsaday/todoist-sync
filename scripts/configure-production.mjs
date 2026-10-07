import { readFile, writeFile, chmod } from 'node:fs/promises'
import { parse } from 'dotenv'
import { pathToFileURL } from 'node:url'
import { resolve, sep } from 'node:path'
const root = process.env.ACCORD_SETUP_ROOT
  ? pathToFileURL(resolve(process.env.ACCORD_SETUP_ROOT) + sep)
  : new URL('../', import.meta.url)
const file = new URL('apps/worker/.dev.vars.production', root)
const values = parse(await readFile(file))
const required = [
  'PUBLIC_URL',
  'D1_DATABASE_ID',
  'D1_DATABASE_NAME',
  'BETTER_AUTH_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TODOIST_CLIENT_ID',
  'TODOIST_CLIENT_SECRET',
  'NOTION_CLIENT_ID',
  'NOTION_CLIENT_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
]
const missing = required.filter((key) => !values[key]?.trim())
if (missing.length) throw new Error('Missing settings: ' + missing.join(', '))
const origin = new URL(values.PUBLIC_URL)
if (
  origin.protocol !== 'https:' ||
  origin.origin !== values.PUBLIC_URL ||
  origin.username ||
  origin.password
)
  throw new Error('PUBLIC_URL must be an HTTPS origin without path or trailing slash')
if (
  !/^[a-f\d-]{36}$/i.test(values.D1_DATABASE_ID) ||
  values.D1_DATABASE_ID === '00000000-0000-0000-0000-000000000000'
)
  throw new Error('Use the actual D1 database UUID')
if (!/^[a-z0-9-]+$/.test(values.D1_DATABASE_NAME)) throw new Error('Invalid D1 database name')
if (Buffer.from(values.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32)
  throw new Error('TOKEN_ENCRYPTION_KEY must encode 32 bytes')
if (values.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET is too short')
if (!values.STRIPE_SECRET_KEY.startsWith('sk_test_'))
  throw new Error('Preparation uses Stripe test keys; enable live separately after acceptance')
const amount = values.STRIPE_PRICE_AMOUNT ?? '6'
if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
  throw new Error('Invalid monthly price')
// The source configuration is JSONC with trailing commas; it has no line comments.
const base = JSON.parse(
  (await readFile(new URL('apps/worker/wrangler.jsonc', root), 'utf8')).replace(
    /,\s*([}\]])/g,
    '$1',
  ),
)
base.name = 'accord'
base.d1_databases[0].database_name = values.D1_DATABASE_NAME
base.d1_databases[0].database_id = values.D1_DATABASE_ID
base.vars = {
  PUBLIC_URL: values.PUBLIC_URL,
  STRIPE_PRICE_AMOUNT: amount,
  STRIPE_PRICE_CURRENCY: (values.STRIPE_PRICE_CURRENCY ?? 'EUR').toUpperCase(),
}
const target = new URL('apps/worker/wrangler.production.json', root)
await writeFile(target, JSON.stringify(base, null, 2) + '\n', { mode: 0o600 })
const secrets = Object.fromEntries(
  required
    .filter((key) => !['PUBLIC_URL', 'D1_DATABASE_ID', 'D1_DATABASE_NAME'].includes(key))
    .map((key) => [key, values[key]]),
)
for (const key of ['NOTION_WEBHOOK_SECRET', 'NOTION_HANDSHAKE_KEY'])
  if (values[key]) secrets[key] = values[key]
await writeFile(
  new URL('apps/worker/.dev.vars.upload.json', root),
  JSON.stringify(secrets) + '\n',
  { mode: 0o600 },
)
await chmod(target, 0o600)
await chmod(new URL('apps/worker/.dev.vars.upload.json', root), 0o600)
console.log(
  'Production configuration and private secret upload file generated. No deployment performed.',
)
