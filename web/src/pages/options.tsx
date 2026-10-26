import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Settings, State } from '@/lib/api'

function Row({ id, title, hint, children }: { id: string; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{title}</Label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Options({
  state,
  saving,
  onSave,
}: {
  state: State
  saving: boolean
  onSave: (settings: Settings) => void
}) {
  const [draft, setDraft] = useState(state.settings)
  useEffect(() => setDraft(state.settings), [state.settings])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings)
  const disabled = !state.canEdit

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Événements</CardTitle>
          <CardDescription>Comment les tâches apparaissent dans l’agenda.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Row
            id="duration"
            title="Durée par défaut"
            hint="Pour une tâche avec une heure mais sans durée, en minutes."
          >
            <Input
              id="duration"
              type="number"
              min={1}
              className="w-24"
              disabled={disabled}
              value={draft.defaultEventDurationMinutes}
              onChange={(e) => set('defaultEventDurationMinutes', Number(e.target.value))}
            />
          </Row>
          <Row id="priority" title="Préfixes de priorité" hint="Ajoute !p1, !p2 ou !p3 au titre selon la priorité.">
            <Switch
              id="priority"
              disabled={disabled}
              checked={draft.priorityPrefixes}
              onCheckedChange={(v) => set('priorityPrefixes', v)}
            />
          </Row>
          <Row id="comments" title="Commentaires" hint="Recopie les commentaires de la tâche dans la description.">
            <Switch
              id="comments"
              disabled={disabled}
              checked={draft.syncComments}
              onCheckedChange={(v) => set('syncComments', v)}
            />
          </Row>
          <Row
            id="foreign"
            title="Événements créés dans l’agenda"
            hint="Un événement ajouté directement dans un agenda associé devient une tâche."
          >
            <Switch
              id="foreign"
              disabled={disabled}
              checked={draft.syncForeignEvents}
              onCheckedChange={(v) => set('syncForeignEvents', v)}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Préfixes d’étiquettes</CardTitle>
          <CardDescription>
            Quand une étiquette correspond, le préfixe est ajouté au titre. La comparaison ignore emoji, espaces et
            ponctuation : « ⚡ 5 min » correspond à « 5min », mais « 15min » non.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {draft.labelPrefixes.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label="Étiquette"
                placeholder="Étiquette"
                disabled={disabled}
                value={entry.match}
                onChange={(e) =>
                  set(
                    'labelPrefixes',
                    draft.labelPrefixes.map((l, i) => (i === index ? { ...l, match: e.target.value } : l)),
                  )
                }
              />
              <Input
                aria-label="Préfixe"
                placeholder="Préfixe"
                disabled={disabled}
                value={entry.prefix}
                onChange={(e) =>
                  set(
                    'labelPrefixes',
                    draft.labelPrefixes.map((l, i) => (i === index ? { ...l, prefix: e.target.value } : l)),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Supprimer"
                disabled={disabled}
                onClick={() =>
                  set(
                    'labelPrefixes',
                    draft.labelPrefixes.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => set('labelPrefixes', [...draft.labelPrefixes, { match: '', prefix: '@' }])}
          >
            <Plus />
            Ajouter
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sécurité</CardTitle>
          <CardDescription>
            Supprimer un événement termine sa tâche. Vider un agenda terminerait donc toutes les tâches liées.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Row
            id="breaker"
            title="Seuil du disjoncteur"
            hint="Au-delà de ce nombre de tâches terminées en un passage, le passage est refusé et rien n’est perdu. 0 désactive la protection."
          >
            <Input
              id="breaker"
              type="number"
              min={0}
              className="w-24"
              disabled={disabled}
              value={draft.maxCompletionsPerSync}
              onChange={(e) => set('maxCompletionsPerSync', Number(e.target.value))}
            />
          </Row>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(state.settings)}>
            Annuler
          </Button>
          <Button disabled={!dirty || saving || disabled} onClick={() => onSave(draft)}>
            {saving && <Loader2 className="animate-spin" />}
            Enregistrer
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
