import { createHmac, timingSafeEqual } from 'node:crypto'

import { getCredentials } from '../config.js'

export const TODOIST_WEBHOOK_PATH = '/webhooks/todoist'
export const TODOIST_SIGNATURE_HEADER = 'x-todoist-hmac-sha256'

/**
 * Verify Todoist's `X-Todoist-Hmac-SHA256` header.
 *
 * The digest is base64 HMAC-SHA256 of the **raw** body under the app's client
 * secret. It must be computed on the bytes as received: re-serialising parsed
 * JSON changes key order and whitespace and will not match.
 */
export function isValidSignature(rawBody: string, signature: string | undefined): boolean {
  if (signature === undefined || signature === '') return false

  const expected = createHmac('sha256', getCredentials().TODOIST_CLIENT_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64')

  // Compare the encoded forms, not the decoded bytes. Buffer.from(_, 'base64')
  // silently ignores anything after the padding, so a decoded comparison
  // accepts `<valid signature>AAAA` as though it were the signature itself.
  const received = Buffer.from(signature, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')

  // timingSafeEqual throws on a length mismatch, so check that first.
  if (received.length !== expectedBytes.length) return false
  return timingSafeEqual(received, expectedBytes)
}
