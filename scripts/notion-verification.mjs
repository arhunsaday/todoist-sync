// Owner-only helper. Prints the verification challenge for manual pasting in Notion.
import { readFile } from 'node:fs/promises'
const file = process.argv[2],
  secret = process.env.TOKEN_ENCRYPTION_KEY
if (!file || !secret) {
  console.error(
    'Usage: TOKEN_ENCRYPTION_KEY=<key> node scripts/notion-verification.mjs <wrangler-json-file>',
  )
  process.exit(1)
}
const data = JSON.parse(await readFile(file, 'utf8'))
const rows = Array.isArray(data) ? data.flatMap((x) => x.results ?? []) : (data.results ?? [])
const envelope = JSON.parse(rows[0]?.encrypted_value ?? 'null')
if (!envelope || envelope.version !== 'v1')
  throw new Error('No supported encrypted Notion challenge in this export.')
const key = await crypto.subtle.importKey('raw', Buffer.from(secret, 'base64'), 'AES-GCM', false, [
  'decrypt',
])
const plaintext = await crypto.subtle.decrypt(
  {
    name: 'AES-GCM',
    iv: Buffer.from(envelope.iv, 'base64'),
    additionalData: new TextEncoder().encode('notion-webhook'),
  },
  key,
  Buffer.from(envelope.ciphertext, 'base64'),
)
process.stdout.write(JSON.parse(new TextDecoder().decode(plaintext)) + '\n')
