export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  SYNC_QUEUE: Queue<{ userId: string; reason: string }>
  SYNC_COORDINATOR: DurableObjectNamespace
  PUBLIC_URL: string
  BETTER_AUTH_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  TODOIST_CLIENT_ID?: string
  TODOIST_CLIENT_SECRET?: string
  NOTION_CLIENT_ID?: string
  NOTION_CLIENT_SECRET?: string
  TOKEN_ENCRYPTION_KEY?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_ID?: string
  NOTION_WEBHOOK_SECRET?: string
  NOTION_HANDSHAKE_KEY?: string
  STRIPE_PRICE_AMOUNT: string
  STRIPE_PRICE_CURRENCY: string
}
