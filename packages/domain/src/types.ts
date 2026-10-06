import type { z } from 'zod'
import type {
  providerSchema,
  fieldSchema,
  scheduleSchema,
  refSchema,
  taskFieldsSchema,
  ruleSchema,
} from './schemas'
export type Provider = z.infer<typeof providerSchema>
export type Field = z.infer<typeof fieldSchema>
export type Schedule = z.infer<typeof scheduleSchema>
export type ResourceRef = z.infer<typeof refSchema>
export type TaskFields = z.infer<typeof taskFieldsSchema>
export type Rule = z.infer<typeof ruleSchema>
export interface Entity {
  id: string
  ref: ResourceRef
  fields: TaskFields
  revision: string
  deleted: boolean
  recurring: boolean
  metadata: Record<string, string>
}
export interface Decision {
  kind: 'write' | 'conflict' | 'unlink' | 'skip'
  entityId: string
  target: ResourceRef
  patch: Partial<TaskFields>
  reason: string
  targetId?: string | null
  sourceId?: string
  originSide?: 'source' | 'destination'
  originId?: string
  moveSource?: boolean
  resolution?: 'source' | 'destination'
}
export interface Link {
  groupId: string
  ruleId: string
  sourceId: string
  destinationId: string
  baseline: TaskFields
  sourceRevision: string
  destinationRevision: string
  detached?: boolean
}
export interface Operation {
  id: string
  userId: string
  ruleId: string
  ruleRevision: number
  groupId: string
  idempotencyKey: string
  decision: Decision
  attempts: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'canceled'
  nextAttemptAt: number
  uncertainCreation?: boolean
}
export interface ProviderResource {
  ref: ResourceRef
  name: string
  writable: boolean
  sections?: { id: string; name: string }[]
  labels?: string[]
  properties?: { id: string; name: string; type: string; options?: string[] }[]
}
export interface ChangePage {
  entities: Entity[]
  nextCursor: string | null
  hasMore: boolean
}
export interface ProviderAdapter {
  discover(): Promise<ProviderResource[]>
  changes(ref: ResourceRef, cursor: string | null): Promise<ChangePage>
  read(ref: ResourceRef, id: string): Promise<Entity | null>
  findMirror(ref: ResourceRef, key: string, legacyTodoistId?: string): Promise<Entity | null>
  write(
    ref: ResourceRef,
    id: string | null,
    patch: Partial<TaskFields>,
    key: string,
    context?: { labels?: string[]; groupId?: string; allowRecreate?: boolean },
  ): Promise<Entity>
  removeMirror(ref: ResourceRef, id: string): Promise<void>
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(message)
  }
}
