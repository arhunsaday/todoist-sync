import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
it('serves health without exposing secrets', async () => {
  const r = await SELF.fetch('https://local.test/api/health')
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ status: 'ok' })
})
