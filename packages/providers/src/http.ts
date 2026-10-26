import { AppError } from '@accord/domain'
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const r = await fetcher(url, init)
  if (!r.ok) {
    const retry = r.headers.get('Retry-After')
    const retrySeconds = retry
      ? Number(retry) || Math.max(1, (Date.parse(retry) - Date.now()) / 1000)
      : undefined
    if (r.status === 401 || r.status === 403)
      throw new AppError('RECONNECT_REQUIRED', 'L’accès à cet outil doit être réautorisé.', 409)
    if (r.status === 429)
      throw new AppError(
        'RATE_LIMITED',
        'Cet outil demande de patienter avant de réessayer.',
        429,
        retrySeconds,
      )
    if (r.status === 410)
      throw new AppError('CURSOR_EXPIRED', 'Le curseur doit être renouvelé.', 410)
    if (r.status === 404)
      throw new AppError(
        'RESOURCE_UNAVAILABLE',
        'Cette ressource est introuvable ou inaccessible.',
        404,
      )
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'Le service connecté n’a pas répondu correctement.',
      502,
    )
  }
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}
export function bearer(token: string) {
  return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
}
