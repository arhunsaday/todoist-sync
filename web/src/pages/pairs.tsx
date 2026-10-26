import { ArrowRight, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { Notice } from '@/components/notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Discovery, Mapping, NamedId, State } from '@/lib/api'

// Radix Select cannot use an empty string as a value.
const NONE = '__none__'

export function Pairs({
  state,
  discovery,
  saving,
  onSave,
}: {
  state: State
  discovery?: Discovery
  saving: boolean
  onSave: (mappings: Mapping[]) => void
}) {
  const saved = useMemo(
    () => Object.fromEntries(state.settings.mappings.map((m) => [m.todoistProjectId, m.googleCalendarId])),
    [state.settings.mappings],
  )
  const [draft, setDraft] = useState<Record<string, string>>(saved)
  useEffect(() => setDraft(saved), [saved])

  if (!state.authorized.todoist || !state.authorized.google) {
    return (
      <Notice notice={{ kind: 'warning', text: 'Connecte Todoist et Google Agenda pour choisir les paires.' }} />
    )
  }

  if (discovery === undefined) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  // Keep pairs whose project is archived or out of reach visible, so saving
  // never drops one silently.
  const known = new Set(discovery.projects.map((p) => p.id))
  const projects: NamedId[] = [
    ...discovery.projects,
    ...Object.keys(saved)
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: `Projet introuvable (${id})` })),
  ]
  const calendarName = (id: string) => discovery.calendars.find((c) => c.id === id)?.name ?? id
  const taken = new Map(Object.entries(draft).map(([project, calendar]) => [calendar, project]))
  const dirty = JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(saved))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projet Todoist → agenda Google</CardTitle>
        <CardDescription>
          Chaque projet choisi est synchronisé dans les deux sens avec son agenda. Un agenda ne peut servir
          qu’à un seul projet. Un projet ajouté est importé dès l’enregistrement ; un projet retiré garde ses
          événements existants.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {discovery.errors.length > 0 && (
          <Notice notice={{ kind: 'error', text: discovery.errors.join('\n') }} />
        )}
        <ul className="divide-y">
          {projects.map((project) => {
            const value = draft[project.id] ?? NONE
            return (
              <li key={project.id} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_auto_1fr] sm:gap-4">
                <span className="truncate font-medium">{project.name}</span>
                <ArrowRight className="hidden size-4 text-muted-foreground sm:block" />
                <Select
                  value={value}
                  disabled={!state.canEdit}
                  onValueChange={(next) =>
                    setDraft((current) => {
                      const updated = { ...current }
                      if (next === NONE) delete updated[project.id]
                      else updated[project.id] = next
                      return updated
                    })
                  }
                >
                  <SelectTrigger aria-label={`Agenda pour ${project.name}`}>
                    <SelectValue>{value === NONE ? 'Non synchronisé' : calendarName(value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Non synchronisé</SelectItem>
                    <SelectSeparator />
                    {discovery.calendars.map((calendar) => {
                      const owner = taken.get(calendar.id)
                      return (
                        <SelectItem
                          key={calendar.id}
                          value={calendar.id}
                          disabled={owner !== undefined && owner !== project.id}
                        >
                          {calendar.name}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </li>
            )
          })}
        </ul>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
          Annuler
        </Button>
        <Button
          disabled={!dirty || saving || !state.canEdit}
          onClick={() =>
            onSave(
              Object.entries(draft).map(([todoistProjectId, googleCalendarId]) => ({
                todoistProjectId,
                googleCalendarId,
              })),
            )
          }
        >
          {saving && <Loader2 className="animate-spin" />}
          Enregistrer
        </Button>
      </CardFooter>
    </Card>
  )
}

function normalize(pairs: Record<string, string>) {
  return Object.entries(pairs).sort(([a], [b]) => a.localeCompare(b))
}
