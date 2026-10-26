import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Repeat2,
  Plug,
  Clock3,
  Settings,
  ArrowUpRight,
  Plus,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Pause,
  Play,
  AlertCircle,
  LogOut,
  Trash2,
  RefreshCw,
} from 'lucide-react'
import { type Rule, type Provider, type ProviderResource, canSync } from '@accord/domain'
import { Brand } from '../components/Brand'
import { ProviderIcon, providerNames } from '../components/ProviderIcon'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { api, post } from '../lib/api'
import {
  demoConnections,
  demoResources,
  demoActivity,
  loadDemoRules,
  type ActivityView,
  type ConnectionView,
} from '../demo/store'
import { useWorkspace, Empty, RuleRow } from './Workspace'
export function Connections() {
  const w = useWorkspace()
  const [busy, setBusy] = useState<Provider | null>(null),
    [disconnect, setDisconnect] = useState<ConnectionView | null>(null)
  async function connect(provider: Provider) {
    if (w.demo) {
      w.toast(
        'En démonstration, les connexions sont fictives. Créez votre espace pour connecter vos comptes.',
      )
      return
    }
    setBusy(provider)
    try {
      const r = await post<{ url: string }>('/connections/' + provider + '/authorize')
      location.assign(r.url)
    } catch (e) {
      w.toast(e instanceof Error ? e.message : 'Connexion impossible')
      setBusy(null)
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Faites entrer vos outils.</h1>
          <p>Vos connexions, au même endroit. Vous choisissez les accès.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await w.reload()
            w.toast('Connexions actualisées.')
          }}
        >
          <RefreshCw size={14} /> Actualiser
        </Button>
      </div>
      <div className="connections-grid">
        {(['todoist', 'google', 'notion'] as const).map((provider) => {
          const c = w.connections.find((x) => x.provider === provider)
          const ok = c?.status === 'connected'
          return (
            <article className="connection-card" key={provider}>
              <ProviderIcon provider={provider} size={45} />
              <h2>{providerNames[provider]}</h2>
              <p>
                {provider === 'todoist'
                  ? 'Vos tâches, projets et étiquettes.'
                  : provider === 'google'
                    ? 'Vos calendriers et vos créneaux.'
                    : 'Vos projets et vos sources de données.'}
              </p>
              <span className={'badge ' + (ok ? '' : 'paused')}>
                {ok ? 'Connecté' : c?.status === 'reconnect' ? 'À reconnecter' : 'Non connecté'}
              </span>
              {ok ? (
                <Button variant="outline" onClick={() => setDisconnect(c!)}>
                  Déconnecter
                </Button>
              ) : (
                <Button onClick={() => connect(provider)} disabled={busy === provider}>
                  {busy === provider ? 'Connexion…' : 'Connecter ' + providerNames[provider]}
                </Button>
              )}
            </article>
          )
        })}
      </div>
      <div className="notice">
        Connectez uniquement les comptes que vous souhaitez synchroniser. Une déconnexion met en
        pause les règles qui utilisent cet outil.
      </div>
      <Dialog
        open={!!disconnect}
        onOpenChange={(v) => !v && setDisconnect(null)}
        title="Déconnecter cet outil ?"
        description="Les règles associées seront suspendues. Les éléments déjà synchronisés seront conservés."
      >
        <div className="editor-footer">
          <Button variant="outline" onClick={() => setDisconnect(null)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!disconnect) return
              if (w.demo) w.toast('La démonstration conserve ses connexions fictives.')
              else {
                await api('/connections/' + disconnect.id, { method: 'DELETE' })
                await w.reload()
              }
              setDisconnect(null)
            }}
          >
            Déconnecter
          </Button>
        </div>
      </Dialog>
    </>
  )
}
