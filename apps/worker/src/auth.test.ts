import { env, SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
it('rejects access without a product session', async () => {
  const r = await SELF.fetch('https://local.test/api/me')
  expect(r.status).toBe(401)
})
it('reports missing production services explicitly', async () => {
  const r = await SELF.fetch('https://local.test/api/config')
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({ googleAuth: false })
})
it('refuses cross origin mutations', async () => {
  const r = await SELF.fetch('https://local.test/api/rules', {
    method: 'POST',
    headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
    body: '{}',
  })
  expect(r.status).toBe(403)
})
