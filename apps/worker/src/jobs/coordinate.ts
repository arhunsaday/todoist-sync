import type { Env } from '../env'
import { AppError } from '@accord/domain'
export async function coordinate<T>(
  env: Env,
  userId: string,
  action: string,
  body: unknown = {},
): Promise<T> {
  const id = env.SYNC_COORDINATOR.idFromName(userId)
  const response = await env.SYNC_COORDINATOR.get(id).fetch('https://internal/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, body }),
  })
  const result = (await response.json()) as { error?: { code: string; message: string } }
  if (!response.ok)
    throw new AppError(
      result.error?.code ?? 'INTERNAL',
      result.error?.message ?? 'Cette action n’a pas abouti.',
      response.status,
    )
  return result as T
}
