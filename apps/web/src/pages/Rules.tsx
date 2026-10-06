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
export function Rules() {
  const w = useWorkspace()
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Vos outils. Vos règles.</h1>
          <p>Les liens qui simplifient votre quotidien.</p>
        </div>
        <Link to={w.base + '/rules/new'} className="button button-primary">
          <Plus size={16} /> Créer une règle
        </Link>
      </div>
      <div className="panel">
        {w.rules.length ? (
          w.rules.map((r) => <RuleRow key={r.id} rule={r} />)
        ) : (
          <Empty
            title="Tout commence par une règle"
            description="Reliez un projet à un calendrier ou à une source de données Notion."
          />
        )}
      </div>
      <div className="notice">
        Prévisualisez chaque règle avant de l’activer. Les règles en pause ne modifient aucune
        donnée.
      </div>
    </>
  )
}
