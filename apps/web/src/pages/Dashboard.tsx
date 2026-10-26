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
import { ActivityList } from './Activity'
export function Dashboard() {
  const w = useWorkspace()
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Bonjour {w.user.name.split(' ')[0]}.</h1>
          <p>Une vue claire sur ce qui travaille ensemble.</p>
        </div>
        <Link to={w.base + '/rules/new'} className="button button-primary">
          <Plus size={16} /> Créer une règle
        </Link>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <span>Règles actives</span>
          <div className="stat-value">{w.rules.filter((r) => r.status === 'active').length}</div>
          <small>Au rythme de vos outils</small>
        </div>
        <div className="stat-card">
          <span>Changements appliqués</span>
          <div className="stat-value">{w.stats.synced}</div>
          <small>{w.demo ? 'Exemple de démonstration' : 'Dans votre historique'}</small>
        </div>
        <div className="stat-card">
          <span>À votre attention</span>
          <div className="stat-value">{w.stats.errors}</div>
          <small>Conflits ou erreurs à vérifier</small>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Vos règles de synchronisation</h2>
          <Link to={w.base + '/rules'}>
            Voir toutes les règles <ArrowUpRight size={12} style={{ display: 'inline' }} />
          </Link>
        </div>
        {w.rules.length ? (
          w.rules.slice(0, 4).map((r) => <RuleRow key={r.id} rule={r} />)
        ) : (
          <Empty
            title="Votre premier accord commence ici"
            description="Connectez vos outils, puis choisissez les informations à synchroniser."
          >
            <Link className="button button-outline" to={w.base + '/connections'}>
              Connecter mes outils
            </Link>
          </Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Les derniers mouvements</h2>
          <Link to={w.base + '/activity'}>Voir l’activité</Link>
        </div>
        <ActivityList items={w.activity.slice(0, 4)} />
      </section>
    </>
  )
}
