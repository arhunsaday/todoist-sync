import { useState } from 'react'
import type { TaskFields, Field, Provider } from '@accord/domain'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import { ProviderIcon, providerNames } from './ProviderIcon'
import { api, post } from '../lib/api'
import { useWorkspace } from '../pages/Workspace'
interface Detail {
  source: TaskFields
  destination: TaskFields
  hash: string
  sourceProvider: Provider
  destinationProvider: Provider
  fields: Field[]
}
const names: Record<Field, string> = {
  title: 'Titre',
  description: 'Description',
  schedule: 'Date et durée',
  completed: 'Statut',
  priority: 'Priorité',
}
function value(field: Field, data: TaskFields) {
  if (field === 'schedule') {
    const s = data.schedule
    if (!s) return 'Sans date'
    if (s.kind === 'date')
      return (
        new Intl.DateTimeFormat('fr', { dateStyle: 'medium', timeZone: 'UTC' }).format(
          new Date(s.date + 'T00:00:00Z'),
        ) + ' · journée entière'
      )
    return (
      new Intl.DateTimeFormat('fr', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: s.timeZone,
      }).format(new Date(s.start)) +
      ' · ' +
      s.durationMinutes +
      ' min'
    )
  }
  if (field === 'completed') return data.completed ? 'Terminé' : 'À faire'
  if (field === 'priority') return 'Priorité ' + data.priority
  return data[field] || '—'
}
export function ConflictResolver({ ruleId, sourceId }: { ruleId: string; sourceId: string }) {
  const w = useWorkspace()
  const [open, setOpen] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function load() {
    setOpen(true)
    setError('')
    try {
      setDetail(
        await api<Detail>('/rules/' + ruleId + '/conflicts/' + encodeURIComponent(sourceId)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Versions indisponibles')
    }
  }
  async function choose(choice: 'source' | 'destination') {
    if (!detail) return
    setBusy(true)
    try {
      await post('/rules/' + ruleId + '/resolve', { sourceId, choice, hash: detail.hash })
      setOpen(false)
      await w.reload()
      w.toast('Votre choix est enregistré. Les éléments vont être remis en accord.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Résolution impossible')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={load}>
        Résoudre
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Retrouver l’accord"
        description="Ces éléments ont été modifiés des deux côtés. Comparez les versions puis choisissez celle à conserver."
      >
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {detail ? (
          <>
            <div className="conflict-comparison">
              {(['source', 'destination'] as const).map((side) => (
                <section key={side}>
                  <div className="conflict-provider">
                    <ProviderIcon
                      provider={
                        detail[(side + 'Provider') as 'sourceProvider' | 'destinationProvider']
                      }
                      size={24}
                    />
                    <strong>
                      {
                        providerNames[
                          detail[(side + 'Provider') as 'sourceProvider' | 'destinationProvider']
                        ]
                      }
                    </strong>
                  </div>
                  {detail.fields.map((field) => (
                    <div className="conflict-value" key={field}>
                      <span>{names[field]}</span>
                      <p>{value(field, detail[side])}</p>
                    </div>
                  ))}
                  <Button
                    disabled={busy}
                    onClick={() => choose(side)}
                    variant={side === 'source' ? 'default' : 'outline'}
                  >
                    Garder cette version
                  </Button>
                </section>
              ))}
            </div>
            <Button variant="ghost" onClick={load} disabled={busy}>
              Actualiser les versions
            </Button>
          </>
        ) : (
          !error && <p className="loading">Lecture des versions…</p>
        )}
      </Dialog>
    </>
  )
}
