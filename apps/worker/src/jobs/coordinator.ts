import { DurableObject } from 'cloudflare:workers'
import { AppError, canSync } from '@accord/domain'
import type { Env } from '../env'
import { userAction } from './actions'
import { billing } from '../storage/db'
export class SyncCoordinator extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve()
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release: () => void = () => {}
    this.tail = new Promise<void>((r) => {
      release = r
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
  async fetch(request: Request) {
    return this.locked(async () => {
      try {
        const input = (await request.json()) as { userId: string; body: Record<string, unknown> }
        if (
          typeof input.userId !== 'string' ||
          this.env.SYNC_COORDINATOR.idFromName(input.userId).toString() !== this.ctx.id.toString()
        )
          throw new AppError(
            'FORBIDDEN',
            'Utilisateur incompatible avec cet espace de travail.',
            403,
          )
        await this.ctx.storage.put('userId', input.userId)
        const result = await userAction(
          this.env,
          input.userId,
          new URL(request.url).pathname.slice(1),
          input.body ?? {},
        )
        await this.schedule(input.userId)
        return Response.json(result)
      } catch (e) {
        if (e instanceof AppError)
          return Response.json(
            { error: { code: e.code, message: e.message } },
            { status: e.status },
          )
        console.error('coordinator failed', e instanceof Error ? e.name : 'Error')
        return Response.json(
          { error: { code: 'INTERNAL', message: 'Cette action n’a pas abouti. Réessayez.' } },
          { status: 500 },
        )
      }
    })
  }
  private async schedule(userId: string) {
    const row = await this.env.DB.prepare(
      "SELECT MIN(next_attempt_at) AS due FROM operations WHERE user_id=? AND status IN ('pending','running')",
    )
      .bind(userId)
      .first<{ due: number | null }>()
    if (row?.due) {
      const b = await billing(this.env.DB, userId, this.env.OWNER_EMAILS)
      const allowed = !b.deleting && canSync(b, Date.now())
      if (allowed) await this.ctx.storage.setAlarm(Math.max(Date.now() + 60000, row.due))
      else await this.ctx.storage.deleteAlarm()
    } else await this.ctx.storage.deleteAlarm()
  }
  async alarm() {
    await this.locked(async () => {
      const userId = await this.ctx.storage.get<string>('userId')
      if (!userId) return
      try {
        await userAction(this.env, userId, 'sync', {})
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 60000)
        return
      }
      await this.schedule(userId)
    })
  }
}
