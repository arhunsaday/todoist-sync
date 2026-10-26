import { CalendarSync, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Notice, type NoticeState } from '@/components/notice'
import { StatusBadge } from '@/components/status-badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, type Discovery, type Settings, type State } from '@/lib/api'
import { Options } from '@/pages/options'
import { Overview } from '@/pages/overview'
import { Pairs } from '@/pages/pairs'

export function App() {
  const [state, setState] = useState<State>()
  const [discovery, setDiscovery] = useState<Discovery>()
  const [notice, setNotice] = useState<NoticeState>()
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setState(await api.state())
    } catch (error) {
      setNotice({ kind: 'error', text: (error as Error).message })
    }
  }, [])

  useEffect(() => {
    void refresh()
    // A pass can run for a while; keep the status honest without a reload.
    const timer = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(timer)
  }, [refresh])

  const authorized = state?.authorized.todoist && state.authorized.google
  useEffect(() => {
    if (!authorized) return
    api
      .discovery()
      .then(setDiscovery)
      .catch((error: Error) => setNotice({ kind: 'error', text: error.message }))
  }, [authorized])

  // Back from an OAuth round trip: say so once, then tidy the URL.
  useEffect(() => {
    const connected = new URLSearchParams(location.search).get('connected')
    if (connected === null) return
    setNotice({
      kind: 'success',
      text: `${connected === 'google' ? 'Google Agenda' : 'Todoist'} est connecté.`,
    })
    history.replaceState(null, '', '/')
  }, [])

  const save = async (settings: Settings, message: string) => {
    setSaving(true)
    try {
      setState(await api.saveSettings(settings))
      setNotice({ kind: 'success', text: message })
    } catch (error) {
      setNotice({ kind: 'error', text: (error as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const resync = async () => {
    try {
      setState(await api.resync())
      setNotice({ kind: 'success', text: 'Resynchronisation lancée en arrière-plan.' })
    } catch (error) {
      setNotice({ kind: 'error', text: (error as Error).message })
    }
  }

  if (state === undefined) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        {notice ? <Notice notice={notice} /> : <Loader2 className="size-5 animate-spin" />}
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <CalendarSync className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Todoist Sync</h1>
            <p className="text-sm text-muted-foreground">Un projet Todoist, un agenda Google.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge state={state} />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={!state.canEdit || !state.syncing}>
                <RefreshCw />
                Resynchroniser
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lancer une resynchronisation complète ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Les curseurs sont remis à zéro et tout est comparé de nouveau. Les tâches déjà
                  synchronisées sont ignorées : seuls les événements manquants ou modifiés sont
                  écrits. Sans risque à répéter.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={() => void resync()}>Resynchroniser</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {notice && <Notice notice={notice} onDismiss={() => setNotice(undefined)} />}

      {!state.canEdit && (
        <Notice
          notice={{
            kind: 'warning',
            text: 'ADMIN_TOKEN n’est pas défini : la page est publique et les réglages ne peuvent pas être enregistrés. Définis-le puis redéploie.',
          }}
        />
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Vue d’ensemble</TabsTrigger>
          <TabsTrigger value="pairs">Paires</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview state={state} discovery={discovery} />
        </TabsContent>
        <TabsContent value="pairs">
          <Pairs
            state={state}
            discovery={discovery}
            saving={saving}
            onSave={(mappings) =>
              save({ ...state.settings, mappings }, 'Paires enregistrées. Import en cours.')
            }
          />
        </TabsContent>
        <TabsContent value="options">
          <Options
            state={state}
            saving={saving}
            onSave={(settings) => save(settings, 'Options enregistrées.')}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
