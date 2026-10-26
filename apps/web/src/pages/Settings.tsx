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
export function SettingsPage() {
  const w = useWorkspace()
  const [open, setOpen] = useState(false),
    [confirmation, setConfirmation] = useState('')
  async function signOut() {
    if (!w.demo) await post('/auth/sign-out')
    location.assign('/')
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Votre espace, simplement.</h1>
          <p>Vos préférences et votre compte.</p>
        </div>
      </div>
      <div className="panel">
        <section className="settings-row">
          <h3>Votre compte</h3>
          <p>
            {w.user.name}
            <br />
            {w.user.email}
          </p>
          <Button variant="outline" onClick={signOut}>
            <LogOut size={15} /> Se déconnecter
          </Button>
        </section>
        <section className="settings-row">
          <h3>Fuseau horaire</h3>
          <p>
            Chaque règle possède son fuseau horaire pour préserver vos horaires. Vous pouvez le
            modifier dans l’éditeur de règle.
          </p>
          <Link className="button button-outline" to={w.base + '/rules'}>
            Voir mes règles
          </Link>
        </section>
        <section className="settings-row">
          <h3>Facturation</h3>
          <p>Votre abonnement et vos factures sont accessibles au même endroit.</p>
          <Link className="button button-outline" to={w.base + '/billing'}>
            Gérer mon abonnement
          </Link>
        </section>
        {w.demo ? (
          <section className="settings-row">
            <h3>Recommencer la démonstration</h3>
            <p>Cette action réinitialise uniquement les données fictives de ce navigateur.</p>
            <Button
              variant="outline"
              onClick={() => {
                localStorage.removeItem('accord-demo-rules')
                location.assign('/demo')
              }}
            >
              Réinitialiser la démo
            </Button>
          </section>
        ) : (
          <section className="settings-row">
            <h3>Supprimer mon compte</h3>
            <p>
              Arrêtez les synchronisations et retirez vos données de cet espace. Les tâches et
              événements présents dans vos outils seront conservés.
            </p>
            <Button variant="danger" onClick={() => setOpen(true)}>
              Supprimer mon compte
            </Button>
          </section>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Supprimer votre compte ?"
        description="Les synchronisations seront arrêtées et votre abonnement annulé. Cette action est définitive."
      >
        <label className="field" style={{ marginTop: 20 }}>
          Saisissez SUPPRIMER
          <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </label>
        <div className="editor-footer">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={confirmation !== 'SUPPRIMER'}
            onClick={async () => {
              try {
                await api('/account', { method: 'DELETE', body: JSON.stringify({ confirmation }) })
                location.assign('/')
              } catch (e) {
                w.toast(e instanceof Error ? e.message : 'Suppression impossible')
              }
            }}
          >
            Supprimer définitivement
          </Button>
        </div>
      </Dialog>
    </>
  )
}
