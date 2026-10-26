import { CheckCircle2, CircleDashed, Copy } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Discovery, State } from '@/lib/api'

const relative = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })

function ago(timestamp: number): string {
  const minutes = Math.round((timestamp - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute')
  return relative.format(Math.round(minutes / 60), 'hour')
}

function Connection({ name, connected, href }: { name: string; connected: boolean; href: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex items-center gap-3">
        {connected ? (
          <CheckCircle2 className="size-5 text-success" />
        ) : (
          <CircleDashed className="size-5 text-muted-foreground" />
        )}
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">{connected ? 'Connecté' : 'Pas encore connecté'}</p>
        </div>
      </div>
      {/* A full navigation, not fetch: the OAuth flow leaves the page. */}
      <Button asChild variant={connected ? 'ghost' : 'default'} size="sm">
        <a href={href}>{connected ? 'Reconnecter' : 'Connecter'}</a>
      </Button>
    </div>
  )
}

export function Overview({ state, discovery }: { state: State; discovery?: Discovery }) {
  const nameOf = (list: Discovery['projects'] | undefined, id: string) =>
    list?.find((entry) => entry.id === id)?.name ?? id

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Comptes</CardTitle>
          <CardDescription>Les deux doivent être connectés pour synchroniser.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <Connection name="Todoist" connected={state.authorized.todoist} href="/setup/todoist" />
          <Connection name="Google Agenda" connected={state.authorized.google} href="/setup/google" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Synchronisation</CardTitle>
          <CardDescription>Webhooks en temps réel, et un passage de rattrapage toutes les 15 minutes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!state.syncing ? (
            <p className="text-muted-foreground">
              En attente : connecte les deux comptes, puis associe au moins un projet à un agenda dans
              l’onglet Paires.
            </p>
          ) : (
            <>
              <p>
                <span className="text-muted-foreground">Dernier passage : </span>
                {state.engine?.running
                  ? 'en cours…'
                  : state.engine?.lastRunAt
                    ? ago(state.engine.lastRunAt)
                    : 'pas encore depuis le démarrage'}
              </p>
              {state.engine?.lastError && (
                <p className="text-destructive">Dernière erreur : {state.engine.lastError}</p>
              )}
              {state.blockedCalendars.length > 0 && (
                <p className="text-destructive">
                  Disjoncteur déclenché sur {state.blockedCalendars.map((id) => nameOf(discovery?.calendars, id)).join(', ')} :
                  trop de tâches auraient été terminées d’un coup. Restaure l’agenda ou relève le seuil dans
                  Options.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Paires actives</CardTitle>
          <CardDescription>Nombre d’événements gérés par agenda.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.settings.mappings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune paire pour l’instant.</p>
          ) : (
            <ul className="divide-y text-sm">
              {state.settings.mappings.map((m) => (
                <li key={m.todoistProjectId} className="flex items-center justify-between gap-4 py-2.5">
                  <span className="truncate">
                    <span className="font-medium">{nameOf(discovery?.projects, m.todoistProjectId)}</span>
                    <span className="text-muted-foreground"> → {nameOf(discovery?.calendars, m.googleCalendarId)}</span>
                  </span>
                  <Badge variant="secondary">{state.linkCounts[m.googleCalendarId] ?? 0} événements</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Webhooks</CardTitle>
          <CardDescription>
            À renseigner dans la console Todoist. Google est enregistré automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            ['Todoist', state.webhooks.todoist],
            ['Google', state.webhooks.google],
          ].map(([label, url]) => (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
              <code className="flex-1 truncate rounded bg-muted px-2 py-1">{url}</code>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Copier l’URL ${label}`}
                onClick={() => void navigator.clipboard.writeText(url!)}
              >
                <Copy />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
