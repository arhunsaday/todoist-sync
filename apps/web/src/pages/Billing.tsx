import { MonthlyPrice } from '../components/MonthlyPrice'
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
export function Billing() {
  const w = useWorkspace()
  async function stripe(kind: 'checkout' | 'portal') {
    if (w.demo) {
      w.toast('Le paiement est désactivé dans la démonstration.')
      return
    }
    try {
      const r = await post<{ url: string }>('/billing/' + kind)
      location.assign(r.url)
    } catch (e) {
      w.toast(e instanceof Error ? e.message : 'Paiement indisponible')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Votre abonnement.</h1>
          <p>Un tarif simple pour une journée plus légère.</p>
        </div>
      </div>
      <div className="panel billing-hero">
        <div>
          <span className="badge">
            {w.billing.subscription?.status === 'active'
              ? 'Abonnement actif'
              : canSync(w.billing, Date.now())
                ? 'Essai en cours'
                : 'Synchronisation suspendue'}
          </span>
          <h2 style={{ marginTop: 18 }}>Tout votre Accord.</h2>
          <MonthlyPrice />
          <p className="muted">Toutes les intégrations, toutes vos règles.</p>
        </div>
        <Button onClick={() => stripe(w.billing.subscription ? 'portal' : 'checkout')}>
          {w.billing.subscription ? 'Gérer mon abonnement' : 'Passer à Accord'}
          <ArrowUpRight size={15} />
        </Button>
      </div>
      {!w.billing.configured && (
        <div className="notice">
          La facturation Stripe n’est pas configurée sur cette instance. Aucun paiement n’est
          disponible.
        </div>
      )}
      <div className="panel settings-row">
        <h3>Vous gardez le choix</h3>
        <p>
          Vous pouvez gérer votre abonnement et vos factures dans le portail Stripe. En fin d’essai
          ou d’abonnement, la synchronisation se met en pause. Les éléments existants restent dans
          vos outils.
        </p>
      </div>
    </>
  )
}
