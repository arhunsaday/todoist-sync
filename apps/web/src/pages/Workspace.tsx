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
interface UserView {
  id: string
  name: string
  email: string
}
interface Preview {
  token: string
  revision: number
  decisions: { kind: string; title: string; reason: string }[]
  total: number
  requiresConfirmation: boolean
}
interface BillingView {
  owner?: boolean
  trialEndsAt: number
  subscription: { status: string; periodEnd: number; pastDueSince: number | null } | null
  configured: boolean
}
interface WorkspaceData {
  user: UserView
  rules: Rule[]
  connections: ConnectionView[]
  resources: ProviderResource[]
  activity: ActivityView[]
  billing: BillingView
  warnings?: string[]
  stats: { synced: number; errors: number }
}
interface WorkspaceContext extends WorkspaceData {
  demo: boolean
  base: string
  saveRule: (rule: Rule, create: boolean) => Promise<void>
  pause: (r: Rule) => Promise<void>
  preview: (r: Rule) => Promise<void>
  remove: (r: Rule) => Promise<void>
  reload: () => Promise<void>
  toast: (s: string) => void
}
const Context = createContext<WorkspaceContext | null>(null)
export function useWorkspace() {
  const c = useContext(Context)
  if (!c) throw new Error('Workspace unavailable')
  return c
}
const demoData = (): WorkspaceData => ({
  user: { id: 'demo', name: 'Camille', email: 'Compte de démonstration' },
  rules: loadDemoRules(),
  connections: demoConnections,
  resources: demoResources,
  activity: demoActivity,
  billing: { trialEndsAt: Date.now() + 14 * 86400000, subscription: null, configured: false },
  stats: { synced: 42, errors: 1 },
})
export function Workspace({ demo = false }: { demo?: boolean }) {
  const [data, setData] = useState<WorkspaceData | null>(demo ? demoData : null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState<{ rule: Rule; data: Preview } | null>(null),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState(false)
  const navigate = useNavigate(),
    base = demo ? '/demo' : '/app'
  async function reload() {
    if (demo) return
    try {
      setData(await api<WorkspaceData>('/bootstrap'))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible')
    }
  }
  useEffect(() => {
    if (!demo) void reload()
  }, [demo])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 4500)
    return () => clearTimeout(t)
  }, [message])
  function setRules(rules: Rule[]) {
    setData((d) => (d ? { ...d, rules } : d))
    if (demo) localStorage.setItem('accord-demo-rules', JSON.stringify(rules))
  }
  async function saveRule(rule: Rule, create: boolean) {
    if (demo) {
      setRules(
        create
          ? [...data!.rules, rule]
          : data!.rules.map((r) => (r.id === rule.id ? { ...rule, revision: r.revision + 1 } : r)),
      )
    } else {
      await api('/rules' + (create ? '' : '/' + rule.id), {
        method: create ? 'POST' : 'PATCH',
        body: JSON.stringify(rule),
      })
      await reload()
    }
    setMessage('Règle enregistrée. Prévisualisez-la avant de l’activer.')
  }
  async function pause(rule: Rule) {
    if (demo) setRules(data!.rules.map((r) => (r.id === rule.id ? { ...r, status: 'paused' } : r)))
    else {
      await post('/rules/' + rule.id + '/pause')
      await reload()
    }
    setMessage('Synchronisation en pause. Vos éléments restent en place.')
  }
  async function showPreview(rule: Rule) {
    try {
      const p = demo
        ? {
            token: 'demo',
            revision: rule.revision,
            total: 3,
            requiresConfirmation: false,
            decisions: [
              { kind: 'write', title: 'Préparer la présentation', reason: 'Créer le miroir.' },
              {
                kind: 'write',
                title: 'Faire le point sur le projet',
                reason: 'Mettre à jour la date.',
              },
              {
                kind: 'skip',
                title: 'Une idée pour plus tard',
                reason: 'La tâche n’a pas de date.',
              },
            ],
          }
        : await post<Preview>('/rules/' + rule.id + '/preview')
      setPreview({ rule, data: p })
      setConfirmation(false)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Aperçu indisponible')
    }
  }
  async function activate() {
    if (!preview) return
    setBusy(true)
    try {
      if (demo)
        setRules(
          data!.rules.map((r) => (r.id === preview.rule.id ? { ...r, status: 'active' } : r)),
        )
      else {
        await post('/rules/' + preview.rule.id + '/activate', {
          token: preview.data.token,
          revision: preview.data.revision,
          confirmMass: confirmation,
        })
        await reload()
      }
      setPreview(null)
      setMessage(
        demo
          ? 'Règle activée dans la démonstration.'
          : 'Règle activée. La synchronisation va démarrer.',
      )
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Activation impossible')
    } finally {
      setBusy(false)
    }
  }
  async function remove(rule: Rule) {
    if (demo) setRules(data!.rules.filter((r) => r.id !== rule.id))
    else {
      await api('/rules/' + rule.id, { method: 'DELETE' })
      await reload()
    }
    setMessage('Règle retirée. Les éléments dans vos outils sont conservés.')
  }
  if (!data)
    return (
      <div className="auth-main">
        <div className="auth-card">
          <Brand />
          {error ? (
            <>
              <div className="notice error" role="alert">
                {error}
              </div>
              <Link to="/login" className="button button-primary">
                Se connecter
              </Link>
              <Button variant="outline" onClick={reload}>
                Réessayer
              </Button>
            </>
          ) : (
            <p className="loading">Votre espace se prépare…</p>
          )}
        </div>
      </div>
    )
  const w: WorkspaceContext = {
    ...data,
    demo,
    base,
    saveRule,
    pause,
    preview: showPreview,
    remove,
    reload,
    toast: setMessage,
  }
  const remaining = Math.max(0, Math.ceil((data.billing.trialEndsAt - Date.now()) / 86400000))
  return (
    <Context.Provider value={w}>
      <div className="app-layout">
        <aside className="sidebar">
          <Brand />
          <div className="workspace-name">Votre espace personnel</div>
          <nav aria-label="Navigation de l’espace">
            {[
              [base, 'Vue d’ensemble', LayoutDashboard],
              [base + '/rules', 'Mes règles', Repeat2],
              [base + '/connections', 'Connexions', Plug],
              [base + '/activity', 'Activité', Clock3],
              [base + '/settings', 'Paramètres', Settings],
            ].map(([to, label, Icon]) => {
              const C = Icon as typeof LayoutDashboard
              return (
                <NavLink key={to as string} to={to as string} end={to === base}>
                  <C size={17} />
                  {label as string}
                </NavLink>
              )
            })}
          </nav>
          <div className="sidebar-footer">
            <div className="trial-badge">
              {data.billing.owner
                ? 'Accès propriétaire, sans abonnement'
                : data.billing.subscription
                  ? 'Votre abonnement Accord'
                  : remaining
                    ? `${remaining} jours pour trouver votre rythme`
                    : 'Votre essai est terminé'}
              <br />
              <Link to={base + '/billing'}>
                Gérer mon abonnement <ArrowUpRight size={11} style={{ display: 'inline' }} />
              </Link>
            </div>
            <div className="sidebar-profile">
              <span className="avatar">{data.user.name.charAt(0)}</span>
              <span>
                {data.user.name}
                <br />
                <small>{demo ? 'Espace de démonstration' : 'Espace personnel'}</small>
              </span>
            </div>
          </div>
        </aside>
        <div className="app-main">
          <header className="app-topbar">
            <span>Un peu moins de bruit. Un peu plus d’accord.</span>
            <div className="topbar-links">
              <Link to="/">
                Accueil <ArrowUpRight size={12} style={{ display: 'inline' }} />
              </Link>
              <span className="avatar">{data.user.name.charAt(0)}</span>
            </div>
          </header>
          {demo && (
            <div className="demo-banner">
              <span>Démonstration — données fictives</span>
              <Link to="/login">Créer mon vrai espace</Link>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <main className="app-content">
            {data.warnings?.map((w) => (
              <div className="notice" role="status" key={w}>
                {w}
              </div>
            ))}
            <Outlet />
          </main>
        </div>
      </div>
      <Dialog
        open={!!preview}
        onOpenChange={(v) => !v && setPreview(null)}
        title="Avant de trouver l’accord"
        description={
          demo
            ? 'Aperçu illustratif — aucune donnée réelle ne sera modifiée.'
            : 'Voici les changements prévus. Vos outils n’ont pas encore été modifiés.'
        }
      >
        {preview && (
          <>
            <div className="preview-counts">
              <span>{preview.data.total} éléments concernés</span>
              <span>
                {preview.data.decisions.filter((d) => d.kind === 'write').length} changements dans
                cet aperçu
              </span>
            </div>
            <div className="preview-list">
              {preview.data.decisions.map((d, i) => (
                <div className="preview-row" key={i}>
                  <span className={'badge ' + (d.kind === 'conflict' ? 'blocked' : '')}>
                    {d.kind === 'write'
                      ? 'Modifier'
                      : d.kind === 'conflict'
                        ? 'Conflit'
                        : d.kind === 'unlink'
                          ? 'Dissocier'
                          : 'Ignorer'}
                  </span>
                  <div>
                    {d.title}
                    <small>{d.reason}</small>
                  </div>
                </div>
              ))}
              {!preview.data.decisions.length && <p className="muted">Tout est déjà en accord.</p>}
            </div>
            {preview.data.requiresConfirmation && (
              <label className="notice" style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={confirmation}
                  onChange={(e) => setConfirmation(e.target.checked)}
                />{' '}
                J’autorise ce lot de modifications au-delà du seuil de protection.
              </label>
            )}
            <div className="editor-footer">
              <Button variant="outline" onClick={() => setPreview(null)}>
                Revenir aux règles
              </Button>
              <Button
                onClick={activate}
                disabled={busy || (preview.data.requiresConfirmation && !confirmation)}
              >
                {busy ? 'Activation…' : 'Activer la synchronisation'}
              </Button>
            </div>
          </>
        )}
      </Dialog>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </Context.Provider>
  )
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <Repeat2 size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  )
}
export function RuleRow({ rule }: { rule: Rule }) {
  const w = useWorkspace()
  const [deleteOpen, setDeleteOpen] = useState(false)
  async function toggle() {
    try {
      if (rule.status === 'active') await w.pause(rule)
      else await w.preview(rule)
    } catch (e) {
      w.toast(e instanceof Error ? e.message : 'Action impossible')
    }
  }
  const source =
    w.resources.find(
      (x) =>
        x.ref.resourceId === rule.source.resourceId &&
        x.ref.connectionId === rule.source.connectionId,
    )?.name ?? rule.source.resourceId
  const destination =
    w.resources.find(
      (x) =>
        x.ref.resourceId === rule.destination.resourceId &&
        x.ref.connectionId === rule.destination.connectionId,
    )?.name ?? rule.destination.resourceId
  return (
    <div className="rule-row">
      <div className="rule-providers">
        <ProviderIcon provider={rule.source.provider} size={32} />
        {rule.direction === 'two-way' ? <ArrowLeftRight size={16} /> : <ArrowRight size={16} />}
        <ProviderIcon provider={rule.destination.provider} size={32} />
      </div>
      <div className="rule-info">
        <strong>{rule.name}</strong>
        <span>
          {source} {rule.direction === 'two-way' ? '↔' : '→'} {destination}
        </span>
      </div>
      <span className={'badge ' + rule.status}>
        {rule.status === 'active'
          ? 'En accord'
          : rule.status === 'paused'
            ? 'En pause'
            : rule.status === 'blocked'
              ? 'À vérifier'
              : 'Brouillon'}
      </span>
      <div className="rule-actions">
        <Link className="button button-ghost button-sm" to={w.base + '/rules/' + rule.id}>
          Modifier
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          aria-label={
            rule.status === 'active' ? 'Mettre en pause ' + rule.name : 'Prévisualiser ' + rule.name
          }
        >
          {rule.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={'Supprimer ' + rule.name}
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Retirer cette règle ?"
        description="La synchronisation s’arrête. Les tâches et événements existants restent dans vos outils."
      >
        <div className="editor-footer">
          <Button variant="outline" onClick={() => setDeleteOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await w.remove(rule)
              setDeleteOpen(false)
            }}
          >
            Retirer la règle
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
