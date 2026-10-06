import { ArrowRight, Check, MoreHorizontal, RefreshCw } from 'lucide-react'
import { ProviderIcon } from './ProviderIcon'
export function FlowPreview() {
  return (
    <div
      className="hero-scene"
      aria-label="Exemple illustré : les tâches Todoist se retrouvent dans Google Agenda"
    >
      <div className="scene-caption">
        <span className="live-dot" /> Une journée, trois outils, un seul rythme.
      </div>
      <div className="task-paper">
        <div className="paper-top">
          <ProviderIcon provider="todoist" size={29} />
          <strong>Mon espace de travail</strong>
          <MoreHorizontal size={18} />
        </div>
        <div className="paper-divider" />
        <div className="paper-date">
          Aujourd’hui <span>3 tâches</span>
        </div>
        <div className="paper-task">
          <span className="task-check red" />
          <div>
            Préparer la présentation
            <span>
              Travail <i /> 09:00 · 1 h
            </span>
          </div>
          <span className="task-label">Focus</span>
        </div>
        <div className="paper-task">
          <span className="task-check orange" />
          <div>
            Faire le point sur le projet
            <span>
              Travail <i /> 11:00 · 30 min
            </span>
          </div>
        </div>
        <div className="paper-task">
          <span className="task-check" />
          <div>
            Lire quelques pages
            <span>
              Personnel <i /> 17:00 · 30 min
            </span>
          </div>
        </div>
        <div className="paper-foot">
          <Check size={13} /> Prêt à synchroniser
        </div>
      </div>
      <div className="sync-bubble">
        <RefreshCw size={21} />
      </div>
      <svg
        className="scene-path"
        viewBox="0 0 900 350"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M320 160C430 160 410 250 530 250"
          fill="none"
          stroke="#8ea79b"
          strokeWidth="1.5"
          strokeDasharray="5 6"
        />
        <path
          d="M445 250C430 320 510 310 630 310"
          fill="none"
          stroke="#8ea79b"
          strokeWidth="1.5"
          strokeDasharray="5 6"
        />
      </svg>
      <div className="calendar-paper">
        <div className="calendar-top">
          <ProviderIcon provider="google" size={27} />
          <strong>Votre journée</strong>
          <span>Mardi 6 octobre</span>
        </div>
        <div className="calendar-grid">
          <div className="calendar-time">09:00</div>
          <div className="calendar-slot event-green">
            <strong>Préparer la présentation</strong>
            <span>09:00 – 10:00</span>
            <ProviderIcon provider="todoist" size={18} />
          </div>
          <div className="calendar-time">10:00</div>
          <div className="calendar-slot" />
          <div className="calendar-time">11:00</div>
          <div className="calendar-slot event-peach">
            <strong>Faire le point sur le projet</strong>
            <span>11:00 – 11:30</span>
          </div>
          <div className="calendar-time">12:00</div>
          <div className="calendar-slot" />
        </div>
      </div>
      <div className="notion-paper">
        <ProviderIcon provider="notion" size={28} />
        <div>
          <strong>Projets & idées</strong>
          <span>Votre Notion rejoint le mouvement</span>
        </div>
        <ArrowRight size={15} />
      </div>
      <div className="scene-note">
        <Check size={12} /> Une modification ici. À jour partout.
      </div>
    </div>
  )
}
