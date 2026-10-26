import { ConflictResolver } from '../components/ConflictResolver'
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
export function ActivityList({ items }: { items: ActivityView[] }) {
  const w = useWorkspace()
  if (!items.length)
    return (
      <Empty
        title="Un espace encore tranquille"
        description="Les changements apparaîtront ici après votre première synchronisation."
      />
    )
  return (
    <>
      {items.map((a) => (
        <div className="activity-row" key={a.id}>
          <span className="activity-icon">
            {a.status === 'conflict' || a.status === 'failed' ? (
              <AlertCircle size={14} />
            ) : (
              <Check size={14} />
            )}
          </span>
          <div>
            <strong>{a.title}</strong>
            <small>{a.detail}</small>
          </div>
          {a.status === 'conflict' && a.ruleId && a.sourceId && (
            <ConflictResolver ruleId={a.ruleId} sourceId={a.sourceId} />
          )}{' '}
          {a.status === 'failed' && a.ruleId && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await post('/rules/' + a.ruleId + '/retry')
                  await w.reload()
                } catch (e) {
                  w.toast(e instanceof Error ? e.message : 'Reprise indisponible')
                }
              }}
            >
              Relancer
            </Button>
          )}
          <time dateTime={new Date(a.createdAt).toISOString()}>
            {new Intl.DateTimeFormat('fr', { hour: '2-digit', minute: '2-digit' }).format(
              a.createdAt,
            )}
          </time>
        </div>
      ))}
    </>
  )
}
export function Activity() {
  const w = useWorkspace()
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Chaque mouvement compte.</h1>
          <p>Comprenez ce qui a changé et ce qui attend votre attention.</p>
        </div>
      </div>
      <div className="panel">
        <ActivityList items={w.activity} />
      </div>
    </>
  )
}
