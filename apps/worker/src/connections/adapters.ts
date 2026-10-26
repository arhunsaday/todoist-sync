import { createTodoistAdapter, createGoogleAdapter, createNotionAdapter } from '@accord/providers'
import {
  makeRule,
  AppError,
  type Rule,
  type ResourceRef,
  type ProviderAdapter,
  type ProviderResource,
} from '@accord/domain'
import type { Env } from '../env'
import { accessToken } from './tokens'
import { connection, connections } from '../storage/db'
export async function adapterFor(
  env: Env,
  userId: string,
  ref: ResourceRef,
  rule: Rule,
): Promise<ProviderAdapter> {
  const c = await connection(env.DB, userId, ref.connectionId)
  if (c.provider !== ref.provider) throw new Error('Provider mismatch')
  const token = () => accessToken(env, userId, c.id)
  const adapter =
    c.provider === 'todoist'
      ? createTodoistAdapter(c.id, token, rule)
      : c.provider === 'google'
        ? createGoogleAdapter(c.id, token, rule)
        : createNotionAdapter(c.id, token, rule)
  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof AppError && e.code === 'RECONNECT_REQUIRED')
        await env.DB.prepare("UPDATE connections SET status='reconnect' WHERE user_id=? AND id=?")
          .bind(userId, c.id)
          .run()
      throw e
    }
  }
  return {
    discover: () => guard(() => adapter.discover()),
    changes: (ref, cursor) => guard(() => adapter.changes(ref, cursor)),
    read: (ref, id) => guard(() => adapter.read(ref, id)),
    findMirror: (ref, key, legacyId) => guard(() => adapter.findMirror(ref, key, legacyId)),
    write: (ref, id, patch, key, context) =>
      guard(() => adapter.write(ref, id, patch, key, context)),
    removeMirror: (ref, id) => guard(() => adapter.removeMirror(ref, id)),
  }
}
export async function discoverAll(
  env: Env,
  userId: string,
): Promise<{ resources: ProviderResource[]; warnings: string[] }> {
  const resources: ProviderResource[] = [],
    warnings: string[] = []
  for (const c of await connections(env.DB, userId)) {
    if (c.status !== 'connected') continue
    try {
      const adapter = await adapterFor(
        env,
        userId,
        { provider: c.provider, connectionId: c.id, resourceId: 'discover' },
        makeRule(userId),
      )
      resources.push(...(await adapter.discover()))
    } catch (e) {
      warnings.push(c.name + ': ' + (e instanceof Error ? e.message : 'Découverte indisponible.'))
    }
  }
  return { resources, warnings }
}
