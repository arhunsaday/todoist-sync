import { randomUUID } from 'node:crypto'

import { logger } from '../logger.js'
import {
  commandResponseSchema,
  syncResponseSchema,
  type CommandResponse,
  type SyncResponse,
  type TodoistCommand,
  type TodoistDue,
  type TodoistDuration,
} from './types.js'

export const TODOIST_API_BASE = 'https://api.todoist.com/api/v1'

const MAX_ATTEMPTS = 4
const RESOURCE_TYPES = ['items', 'projects'] as const

export class TodoistApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Todoist API returned ${status}: ${body.slice(0, 500)}`)
    this.name = 'TodoistApiError'
  }
}

export class TodoistCommandError extends Error {
  constructor(readonly failures: Array<{ uuid: string; error: string }>) {
    super(
      `Todoist rejected ${failures.length} command(s): ` +
        failures.map((f) => `${f.uuid}=${f.error}`).join(', '),
    )
    this.name = 'TodoistCommandError'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Honours `Retry-After` when present, otherwise exponential backoff. */
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')
  if (header !== null) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  }
  return 2 ** attempt * 500
}

export interface TodoistClientOptions {
  /** Async so the caller can refresh an expired token transparently. */
  getAccessToken: () => Promise<string>
  /** When true, mutating calls are logged and skipped. */
  dryRun?: boolean
}

export class TodoistClient {
  constructor(private readonly options: TodoistClientOptions) {}

  private async postForm(
    path: string,
    params: Record<string, string>,
  ): Promise<unknown> {
    const token = await this.options.getAccessToken()
    const body = new URLSearchParams(params)

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await fetch(`${TODOIST_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      })

      if (response.ok) return response.json()

      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === MAX_ATTEMPTS - 1) {
        throw new TodoistApiError(response.status, await response.text())
      }

      const delay = retryDelayMs(response, attempt)
      logger.warn(
        { status: response.status, attempt: attempt + 1, delay },
        'todoist request failed, retrying',
      )
      await sleep(delay)
    }

    /* c8 ignore next */
    throw new Error('unreachable')
  }

  /**
   * Incremental read. Pass `*` for a full sync.
   *
   * The returned `sync_token` must only be persisted once the caller has
   * successfully applied every change in the response — persisting it earlier
   * loses any change that failed to apply.
   */
  async sync(syncToken: string): Promise<SyncResponse> {
    const raw = await this.postForm('/sync', {
      sync_token: syncToken,
      resource_types: JSON.stringify(RESOURCE_TYPES),
    })
    return syncResponseSchema.parse(raw)
  }

  /**
   * Write path.
   *
   * The `sync_token` in the response is deliberately ignored: read and write
   * cursors stay decoupled, so our own writes come back on the next read and
   * are discarded there by fingerprint comparison. That keeps exactly one
   * mechanism responsible for loop prevention.
   */
  async executeCommands(commands: TodoistCommand[]): Promise<CommandResponse> {
    if (commands.length === 0) {
      return { temp_id_mapping: {}, sync_status: {} }
    }

    if (this.options.dryRun === true) {
      logger.info({ commands }, '[dry-run] would send Todoist commands')
      return { temp_id_mapping: {}, sync_status: {} }
    }

    const raw = await this.postForm('/sync', {
      commands: JSON.stringify(commands),
    })
    const parsed = commandResponseSchema.parse(raw)

    const failures = Object.entries(parsed.sync_status)
      .filter(([, status]) => status !== 'ok')
      .map(([uuid, status]) => ({
        uuid,
        error: typeof status === 'string' ? status : status.error,
      }))

    if (failures.length > 0) throw new TodoistCommandError(failures)

    return parsed
  }
}

/* -------------------------------------------------------------------------- */
/* Command builders                                                           */
/* -------------------------------------------------------------------------- */

export interface ItemWriteArgs {
  content?: string
  description?: string
  /** `null` clears the due date, leaving the task undated. */
  due?: Pick<TodoistDue, 'date' | 'timezone'> | null
  duration?: TodoistDuration | null
}

export function itemAdd(
  projectId: string,
  args: ItemWriteArgs & { content: string },
): TodoistCommand & { temp_id: string } {
  return {
    type: 'item_add',
    uuid: randomUUID(),
    temp_id: randomUUID(),
    args: { ...args, project_id: projectId },
  }
}

export function itemUpdate(id: string, args: ItemWriteArgs): TodoistCommand {
  return { type: 'item_update', uuid: randomUUID(), args: { ...args, id } }
}

export function itemMove(id: string, projectId: string): TodoistCommand {
  return {
    type: 'item_move',
    uuid: randomUUID(),
    args: { id, project_id: projectId },
  }
}

export function itemComplete(id: string): TodoistCommand {
  return { type: 'item_complete', uuid: randomUUID(), args: { id } }
}

export function itemUncomplete(id: string): TodoistCommand {
  return { type: 'item_uncomplete', uuid: randomUUID(), args: { id } }
}
