import { Badge } from '@/components/ui/badge'
import type { State } from '@/lib/api'

export function StatusBadge({ state }: { state: State }) {
  if (!state.syncing) return <Badge variant="warning">Configuration à terminer</Badge>
  if (state.blockedCalendars.length > 0) return <Badge variant="destructive">Bloqué</Badge>
  if (state.engine?.lastError) return <Badge variant="destructive">Erreur</Badge>
  if (state.engine?.running) return <Badge variant="secondary">Synchronisation…</Badge>
  return <Badge variant="success">Actif</Badge>
}
