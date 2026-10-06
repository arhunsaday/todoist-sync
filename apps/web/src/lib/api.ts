export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error?.message ?? 'La requête n’a pas abouti. Réessayez.')
  return data as T
}
export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) })
}
