import { AppError } from '@accord/domain'
const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
async function key(secret: string) {
  try {
    const k = bytes(secret)
    if (k.length !== 32) throw new Error()
    return await crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt'])
  } catch {
    throw new AppError(
      'CONFIGURATION',
      'La clé de chiffrement doit être une clé de 32 octets en base64.',
      503,
    )
  }
}
export async function sealToken(
  value: unknown,
  secret: string,
  keyVersion: string,
  associatedData: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(associatedData) },
    await key(secret),
    enc.encode(JSON.stringify(value)),
  )
  return JSON.stringify({
    version: keyVersion,
    iv: b64(iv),
    ciphertext: b64(new Uint8Array(ciphertext)),
  })
}
export async function openToken<T>(
  value: string,
  secret: string,
  keyVersion: string,
  associatedData: string,
): Promise<T> {
  const envelope = JSON.parse(value)
  if (envelope.version !== keyVersion)
    throw new AppError('CONFIGURATION', 'Version de clé de chiffrement non disponible.', 503)
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: enc.encode(associatedData) },
    await key(secret),
    bytes(envelope.ciphertext),
  )
  return JSON.parse(dec.decode(clear))
}
export async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('')
}
export async function verifyHmac(
  raw: string,
  signature: string,
  secret: string,
  format: 'hex' | 'base64' = 'hex',
) {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(raw)))
  const expected =
    format === 'base64'
      ? b64(signed)
      : Array.from(signed, (x) => x.toString(16).padStart(2, '0')).join('')
  if (expected.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expected.length; i++)
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return result === 0
}
