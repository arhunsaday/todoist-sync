import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import {
  makeRule,
  ruleSchema,
  type Rule,
  type Provider,
  type ProviderResource,
} from '@accord/domain'
import { Button } from '../components/ui/button'
import { Switch } from '../components/ui/switch'
import { ProviderIcon, providerNames } from '../components/ProviderIcon'
import { useWorkspace } from './Workspace'
const fieldNames = {
  title: 'Titre',
  description: 'Description',
  schedule: 'Date et durée',
  completed: 'Statut',
  priority: 'Priorité',
}
export function RuleEditor() {
  const w = useWorkspace(),
    { id } = useParams(),
    navigate = useNavigate()
  const existing = w.rules.find((r) => r.id === id)
  const [rule, setRule] = useState<Rule>(() =>
    existing ? structuredClone(existing) : makeRule(w.user.id),
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const newRule = !existing
  function option<K extends keyof Rule['options']>(key: K, value: Rule['options'][K]) {
    setRule((r) => ({ ...r, options: { ...r.options, [key]: value } }))
  }
  function provider(side: 'source' | 'destination', p: Provider) {
    setRule((r) => ({ ...r, [side]: { provider: p, connectionId: '', resourceId: '' } }))
  }
  function resource(side: 'source' | 'destination', resourceId: string) {
    const found = w.resources.find(
      (x) => x.ref.provider === rule[side].provider && x.ref.resourceId === resourceId,
    )
    if (!found) return
    setRule((r) => ({
      ...r,
      [side]: found.ref,
      fields: found.ref.provider === 'notion' ? ['title', 'schedule', 'completed'] : r.fields,
      notionMapping:
        found.ref.provider === 'notion'
          ? {
              title: found.properties?.find((p) => p.type === 'title')?.id ?? '',
              date: found.properties?.find((p) => p.type === 'date')?.id ?? '',
              status:
                found.properties?.find((p) => p.type === 'status' || p.type === 'select')?.id ?? '',
              doneValues: [],
              openValue: '',
              doneValue: '',
              mirrorKey: found.properties?.find((p) => p.name === 'Accord ID')?.id,
            }
          : r.notionMapping,
    }))
  }
  async function save() {
    setError('')
    const parsed = ruleSchema.safeParse(rule)
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(' · '))
      return
    }
    setBusy(true)
    try {
      await w.saveRule({ ...parsed.data, status: 'draft' }, newRule)
      navigate(w.base + '/rules')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }
  const sourceResource = w.resources.find(
    (r) =>
      r.ref.connectionId === rule.source.connectionId &&
      r.ref.resourceId === rule.source.resourceId,
  )
  const notionRef =
    rule.source.provider === 'notion'
      ? rule.source
      : rule.destination.provider === 'notion'
        ? rule.destination
        : null
  const notion = w.resources.find(
    (x) =>
      x.ref.connectionId === notionRef?.connectionId && x.ref.resourceId === notionRef?.resourceId,
  )
  const mapping = rule.notionMapping
  function setMapping(key: string, value: unknown) {
    setRule((r) => ({
      ...r,
      notionMapping: {
        title: '',
        date: '',
        status: '',
        doneValues: [],
        openValue: '',
        doneValue: '',
        ...r.notionMapping,
        [key]: value,
      },
    }))
  }
  return (
    <div className="editor">
      <Link className="back-link" to={w.base + '/rules'}>
        <ArrowLeft size={14} /> Toutes les règles
      </Link>
      <div className="page-heading">
        <div>
          <h1>{newRule ? 'Nouvelle règle' : 'Votre règle'}</h1>
          <p>Faites travailler vos outils à votre façon.</p>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <section className="form-section">
        <h2>Donnez-lui un nom</h2>
        <p className="muted">Un nom qui vous aide à retrouver cette synchronisation.</p>
        <label className="field">
          Nom de la règle
          <input
            value={rule.name}
            maxLength={100}
            onChange={(e) => setRule({ ...rule, name: e.target.value })}
          />
        </label>
      </section>
      <section className="form-section">
        <h2>Reliez deux outils</h2>
        <p className="muted">Choisissez les informations qui doivent rester en accord.</p>
        <div className="form-grid">
          {(['source', 'destination'] as const).map((side) => (
            <div key={side}>
              <label className="field">
                {side === 'source' ? 'Outil source' : 'Outil de destination'}
                <select
                  value={rule[side].provider}
                  onChange={(e) => provider(side, e.target.value as Provider)}
                >
                  {Object.entries(providerNames).map(([p, name]) => (
                    <option
                      key={p}
                      value={p}
                      disabled={p === rule[side === 'source' ? 'destination' : 'source'].provider}
                    >
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ marginTop: 15 }}>
                {rule[side].provider === 'google'
                  ? side === 'source'
                    ? 'Calendrier source'
                    : 'Calendrier de destination'
                  : rule[side].provider === 'notion'
                    ? side === 'source'
                      ? 'Source de données Notion'
                      : 'Destination Notion'
                    : side === 'source'
                      ? 'Projet source'
                      : 'Projet de destination'}
                <select
                  value={rule[side].resourceId}
                  onChange={(e) => resource(side, e.target.value)}
                >
                  <option value="">Choisir une ressource</option>
                  {w.resources
                    .filter((x) => x.ref.provider === rule[side].provider && x.writable)
                    .map((x) => (
                      <option key={x.ref.resourceId} value={x.ref.resourceId}>
                        {x.name}
                      </option>
                    ))}
                </select>
                {!w.resources.some((x) => x.ref.provider === rule[side].provider) && (
                  <small>Connectez cet outil dans la page Connexions.</small>
                )}
              </label>
            </div>
          ))}
        </div>
        <div className="field-line" style={{ marginTop: 17 }}>
          <div>
            <strong>Synchroniser dans les deux sens</strong>
            <p>Vos modifications se retrouvent dans les deux outils.</p>
          </div>
          <Switch
            aria-label="Synchroniser dans les deux sens"
            checked={rule.direction === 'two-way'}
            onCheckedChange={(v) => setRule({ ...rule, direction: v ? 'two-way' : 'one-way' })}
          />
        </div>
      </section>
      {notionRef && (
        <section className="form-section">
          <h2>Les propriétés Notion</h2>
          <p className="muted">
            Associez chaque champ à une propriété existante. Les autres propriétés et le contenu des
            pages sont préservés.
          </p>
          <div className="form-grid">
            {[
              { key: 'title', label: 'Propriété titre', types: ['title'] },
              { key: 'date', label: 'Propriété date', types: ['date'] },
              { key: 'status', label: 'Propriété statut', types: ['status', 'select'] },
              { key: 'mirrorKey', label: 'Propriété Accord ID', types: ['rich_text'] },
            ].map((p) => (
              <label key={p.key} className="field">
                {p.label}
                <select
                  value={(mapping as unknown as Record<string, string>)?.[p.key] ?? ''}
                  onChange={(e) => setMapping(p.key, e.target.value)}
                >
                  <option value="">Choisir une propriété</option>
                  {notion?.properties
                    ?.filter((x) => p.types.includes(x.type))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <label className="field">
              Statut à faire
              <input
                value={mapping?.openValue ?? ''}
                onChange={(e) => setMapping('openValue', e.target.value)}
              />
            </label>
            <label className="field">
              Statut terminé
              <input
                value={mapping?.doneValue ?? ''}
                onChange={(e) => {
                  setMapping('doneValue', e.target.value)
                  setMapping('doneValues', [e.target.value])
                }}
              />
            </label>
          </div>
          <div className="notice">
            Pour créer des pages sans doublon, choisissez une propriété texte dédiée « Accord ID ».
          </div>
        </section>
      )}
      <section className="form-section">
        <h2>Choisissez les champs</h2>
        <p className="muted">Accord ne modifiera que les informations sélectionnées.</p>
        {Object.entries(fieldNames).map(([key, name]) => (
          <div className="field-line" key={key}>
            <strong>{name}</strong>
            <Switch
              aria-label={name}
              checked={rule.fields.includes(key as Rule['fields'][number])}
              onCheckedChange={(v) =>
                setRule({
                  ...rule,
                  fields: v
                    ? [...rule.fields, key as Rule['fields'][number]]
                    : rule.fields.filter((x) => x !== key),
                })
              }
            />
          </div>
        ))}
      </section>
      <section className="form-section">
        <h2>Affinez votre sélection</h2>
        <p className="muted">Tous les filtres renseignés doivent correspondre.</p>
        <div className="form-grid">
          <label className="field">
            Étiquettes Todoist
            <input
              placeholder="Focus, Travail"
              value={rule.filters.labels.join(', ')}
              onChange={(e) =>
                setRule({
                  ...rule,
                  filters: {
                    ...rule.filters,
                    labels: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
            <small>La tâche doit avoir toutes ces étiquettes.</small>
          </label>
          <label className="field">
            Sections Todoist
            <select
              multiple
              value={rule.filters.sectionIds}
              onChange={(e) =>
                setRule({
                  ...rule,
                  filters: {
                    ...rule.filters,
                    sectionIds: Array.from(e.target.selectedOptions, (o) => o.value),
                  },
                })
              }
            >
              {(sourceResource?.sections ?? []).map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
            <small>Aucune sélection : toutes les sections.</small>
          </label>
        </div>
        <div className="checkbox-group">
          {[1, 2, 3, 4].map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={rule.filters.priorities.includes(p)}
                onChange={(e) =>
                  setRule({
                    ...rule,
                    filters: {
                      ...rule.filters,
                      priorities: e.target.checked
                        ? [...rule.filters.priorities, p]
                        : rule.filters.priorities.filter((x) => x !== p),
                    },
                  })
                }
              />
              Priorité {p}
            </label>
          ))}
        </div>
        <div className="field-line">
          <div>
            <strong>Uniquement les tâches datées</strong>
            <p>Nécessaire pour les éléments envoyés vers un agenda.</p>
          </div>
          <Switch
            aria-label="Uniquement les tâches datées"
            checked={rule.filters.datedOnly}
            onCheckedChange={(v) =>
              setRule({ ...rule, filters: { ...rule.filters, datedOnly: v } })
            }
          />
        </div>
        <div className="field-line">
          <strong>Inclure les journées entières</strong>
          <Switch
            aria-label="Inclure les journées entières"
            checked={rule.options.syncAllDay}
            onCheckedChange={(v) => option('syncAllDay', v)}
          />
        </div>
      </section>
      <section className="form-section">
        <h2>Les détails qui comptent</h2>
        <p className="muted">Décidez comment Accord traite vos dates et vos changements.</p>
        <div className="form-grid">
          <label className="field">
            Durée par défaut (minutes)
            <input
              type="number"
              min={1}
              max={1440}
              value={rule.options.durationMinutes}
              onChange={(e) => option('durationMinutes', Number(e.target.value))}
            />
          </label>
          <label className="field">
            Fuseau horaire
            <input
              value={rule.options.timeZone}
              onChange={(e) => option('timeZone', e.target.value)}
            />
          </label>
          <label className="field">
            En cas de conflit
            <select
              value={rule.options.conflict}
              onChange={(e) => option('conflict', e.target.value as Rule['options']['conflict'])}
            >
              <option value="manual">Me laisser choisir</option>
              <option value="source">Préférer la source</option>
              <option value="destination">Préférer la destination</option>
            </select>
          </label>
          <label className="field">
            Événement supprimé
            <select
              value={rule.options.eventDeletion}
              onChange={(e) => option('eventDeletion', e.target.value as 'unlink' | 'complete')}
            >
              <option value="unlink">Dissocier les éléments</option>
              <option value="complete">Terminer la tâche liée</option>
            </select>
          </label>
          <label className="field">
            Tâche terminée
            <select
              value={rule.options.completion}
              onChange={(e) => option('completion', e.target.value as 'mark' | 'remove')}
            >
              <option value="mark">Marquer l’événement comme terminé</option>
              <option value="remove">Retirer l’événement de l’agenda</option>
            </select>
          </label>
          <label className="field">
            Seuil de protection
            <input
              type="number"
              min={1}
              max={10000}
              value={rule.options.maxMutations}
              onChange={(e) => option('maxMutations', Number(e.target.value))}
            />
            <small>Au-delà, l’activation demande une confirmation.</small>
          </label>
        </div>
        <div className="field-line">
          <strong>Afficher la priorité dans le titre</strong>
          <Switch
            aria-label="Afficher la priorité dans le titre"
            checked={rule.options.priorityPrefix}
            onCheckedChange={(v) => option('priorityPrefix', v)}
          />
        </div>
        <div className="field-line">
          <div>
            <strong>Inclure les commentaires Todoist</strong>
            <p>Copie vers l’agenda uniquement.</p>
          </div>
          <Switch
            aria-label="Inclure les commentaires Todoist"
            checked={rule.options.syncComments}
            onCheckedChange={(v) => option('syncComments', v)}
          />
        </div>
      </section>
      {rule.source.provider === 'todoist' && rule.destination.provider === 'google' && (
        <section className="form-section">
          <h2>Reprendre une ancienne synchronisation</h2>
          <p className="muted">
            Retrouvez les événements créés par votre ancienne installation de ce projet.
            Prévisualisez les changements après avoir arrêté l’ancien service.
          </p>
          <div className="field-line">
            <strong>Adopter mes événements existants</strong>
            <Switch
              aria-label="Adopter mes événements existants"
              checked={rule.options.adoptLegacy}
              onCheckedChange={(v) => option('adoptLegacy', v)}
            />
          </div>
        </section>
      )}
      <section className="form-section">
        <h2>Les préfixes d’étiquettes</h2>
        <p className="muted">
          Affichez une courte indication dans le titre de l’événement, par exemple Focus → @focus.
        </p>
        {Object.entries(rule.options.labelPrefixes).map(([label, prefix]) => (
          <div className="form-grid" key={label} style={{ marginBottom: 12 }}>
            <label className="field">
              Étiquette
              <input value={label} readOnly />
            </label>
            <label className="field">
              Préfixe affiché
              <input
                value={prefix}
                onChange={(e) =>
                  option('labelPrefixes', {
                    ...rule.options.labelPrefixes,
                    [label]: e.target.value,
                  })
                }
              />
            </label>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const label = rule.filters.labels.find((l) => !rule.options.labelPrefixes[l])
            if (label)
              option('labelPrefixes', { ...rule.options.labelPrefixes, [label]: '@' + label })
            else setError('Choisissez d’abord une étiquette dans les filtres.')
          }}
        >
          Ajouter une étiquette sélectionnée
        </Button>
      </section>
      <div className="editor-footer">
        <Link to={w.base + '/rules'} className="button button-ghost">
          Annuler
        </Link>
        <Button onClick={save} disabled={busy}>
          <Check size={16} />
          {busy ? 'Enregistrement…' : 'Enregistrer la règle'}
        </Button>
      </div>
    </div>
  )
}
