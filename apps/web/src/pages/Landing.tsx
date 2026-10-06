import { MonthlyPrice } from '../components/MonthlyPrice'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  SlidersHorizontal,
  Repeat2,
  Eye,
  ShieldCheck,
  MoveRight,
  Menu,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Brand } from '../components/Brand'
import { ProviderIcon } from '../components/ProviderIcon'
import { FlowPreview } from '../components/FlowPreview'
const faqs = [
  [
    'Comment fonctionne la synchronisation ?',
    'Vous connectez vos comptes, choisissez vos projets ou calendriers et créez une règle. Accord lit les changements et met à jour les éléments liés. Vous pouvez prévisualiser les opérations avant de les activer.',
  ],
  [
    'Puis-je choisir plusieurs calendriers ?',
    'Oui. Chaque règle relie un projet ou une source de données au calendrier de votre choix. Séparez votre travail et votre vie personnelle sans les mélanger.',
  ],
  [
    'Que se passe-t-il si je modifie une tâche des deux côtés ?',
    'Accord compare les champs modifiés. Les changements indépendants sont fusionnés. En cas de conflit sur le même champ, vous pouvez choisir la version à conserver.',
  ],
  [
    'Mes tâches récurrentes sont-elles prises en charge ?',
    'Accord suit l’occurrence actuelle de vos tâches Todoist. Les séries Google créées indépendamment et les récurrences complexes ne sont pas converties automatiquement.',
  ],
  [
    'Dois-je fournir ma carte pour essayer ?',
    'Non. L’essai dure 14 jours, sans carte bancaire. Vous choisissez ensuite de souscrire à l’abonnement mensuel.',
  ],
  [
    'Que deviennent mes données si j’arrête ?',
    'La synchronisation s’arrête. Les tâches et les événements existants restent dans vos outils. Vous pouvez déconnecter vos comptes à tout moment.',
  ],
]
export function Landing() {
  const [menu, setMenu] = useState(false)
  return (
    <div className="landing">
      <header className="site-header">
        <Brand />
        <nav className={menu ? 'site-nav is-open' : 'site-nav'} aria-label="Navigation principale">
          <a href="#fonctionnement" onClick={() => setMenu(false)}>
            Comment ça marche
          </a>
          <a href="#possibilites" onClick={() => setMenu(false)}>
            Les possibilités
          </a>
          <a href="#tarifs" onClick={() => setMenu(false)}>
            Tarifs
          </a>
        </nav>
        <div className="header-actions">
          <Link className="login-link" to="/login">
            Se connecter
          </Link>
          <Link className="button button-primary button-sm" to="/login">
            Commencer
          </Link>
          <button
            className="mobile-menu"
            aria-label={menu ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-intro">
            <div className="integration-pill">
              <span className="live-dot" /> Todoist, Notion & Google Agenda
            </div>
            <h1>
              Vos tâches et votre agenda,
              <br />
              enfin d’accord.
            </h1>
            <p>
              Moins d’allers-retours. Plus de place pour ce qui compte.
              <br className="desktop-break" /> Connectez vos outils et laissez votre journée prendre
              forme.
            </p>
            <div className="hero-actions">
              <Link to="/login" className="button button-primary">
                Essayer gratuitement <ArrowRight size={17} />
              </Link>
              <Link to="/demo" className="button button-outline">
                Voir la démo <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="hero-reassurance">
              14 jours pour trouver votre rythme. Sans carte bancaire.
            </div>
          </div>
          <FlowPreview />
          <div className="provider-strip">
            <span>
              Vos outils préférés.
              <br />
              <strong>Une même longueur d’onde.</strong>
            </span>
            <div>
              <ProviderIcon provider="todoist" />
              <strong>Todoist</strong>
            </div>
            <span className="strip-plus">+</span>
            <div>
              <ProviderIcon provider="notion" />
              <strong>Notion</strong>
            </div>
            <span className="strip-plus">+</span>
            <div>
              <ProviderIcon provider="google" />
              <strong>Google Agenda</strong>
            </div>
          </div>
        </section>
        <section id="possibilites" className="possibilities section-wrap">
          <div className="section-heading">
            <span className="small-label">Votre organisation, vos règles</span>
            <h2>
              Tout s’accorde.
              <br />
              Rien ne vous échappe.
            </h2>
            <p>Votre façon de travailler mérite mieux qu’une synchronisation à sens unique.</p>
          </div>
          <div className="feature-grid">
            <article className="feature feature-wide">
              <div className="mini-flow">
                <ProviderIcon provider="todoist" size={45} />
                <span className="mini-line" />
                <Repeat2 size={24} />
                <span className="mini-line" />
                <ProviderIcon provider="google" size={45} />
              </div>
              <Repeat2 className="feature-icon" size={20} />
              <h3>Ça va dans les deux sens.</h3>
              <p>
                Déplacez un créneau dans votre agenda. Retrouvez la nouvelle date dans votre liste
                de tâches. Vos outils restent sur la même page.
              </p>
            </article>
            <article className="feature feature-rules">
              <div className="mini-rule">
                <span>Si l’étiquette est</span>
                <strong>✦ Focus</strong>
                <span>Synchroniser vers</span>
                <strong>
                  <span className="color-dot" /> Calendrier Travail
                </strong>
              </div>
              <SlidersHorizontal className="feature-icon" size={20} />
              <h3>Vous gardez la main.</h3>
              <p>
                Choisissez les projets, les étiquettes, les champs et les calendriers. Chaque règle
                s’adapte à votre quotidien.
              </p>
            </article>
            <article className="feature feature-small">
              <Eye className="feature-icon" size={20} />
              <h3>D’abord voir. Puis activer.</h3>
              <p>
                Un aperçu clair des changements avant de démarrer. Et un historique pour comprendre
                ce qui s’est passé.
              </p>
            </article>
            <article className="feature feature-small">
              <ShieldCheck className="feature-icon" size={20} />
              <h3>Vos données, en confiance.</h3>
              <p>
                Des connexions autorisées par vous, des jetons chiffrés et des conflits visibles.
                Déconnectez vos outils quand vous le souhaitez.
              </p>
            </article>
          </div>
        </section>
        <section id="fonctionnement" className="how-section section-wrap">
          <div className="section-heading centered">
            <span className="small-label">Simple, du premier clic au dernier</span>
            <h2>
              Trois étapes.
              <br />
              Et votre journée respire.
            </h2>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">1</span>
              <h3>Connectez vos outils</h3>
              <p>
                Autorisez Accord à accéder aux comptes que vous choisissez. Aucun identifiant à
                copier.
              </p>
            </article>
            <MoveRight className="step-arrow" />
            <article>
              <span className="step-number">2</span>
              <h3>Trouvez votre accord</h3>
              <p>
                Choisissez un modèle, vos projets et vos calendriers. Ajustez les règles à votre
                façon de travailler.
              </p>
            </article>
            <MoveRight className="step-arrow" />
            <article>
              <span className="step-number">3</span>
              <h3>Laissez faire</h3>
              <p>
                Vérifiez l’aperçu, activez la synchronisation et retrouvez vos informations là où
                vous en avez besoin.
              </p>
            </article>
          </div>
        </section>
        <section id="tarifs" className="pricing-section section-wrap">
          <div className="pricing-copy">
            <span className="small-label">Un prix simple. Une journée plus légère.</span>
            <h2>
              Moins de friction.
              <br />
              Plus de temps pour vous.
            </h2>
            <p>
              Toutes les intégrations. Tous les réglages.
              <br />
              Un seul abonnement, sans engagement.
            </p>
            <span className="pricing-note">Commencez avec 14 jours d’essai gratuit.</span>
          </div>
          <div className="pricing-card">
            <div className="plan-heading">
              <span>Accord</span>
              <span className="plan-badge">Tout est inclus</span>
            </div>
            <MonthlyPrice />
            <p className="muted">Pour mettre tous vos outils au diapason.</p>
            <ul>
              {[
                'Todoist, Notion et Google Agenda',
                'Synchronisation dans les deux sens',
                'Règles et filtres personnalisables',
                'Prévisualisation et historique',
                'Gestion des conflits et reprises automatiques',
              ].map((x) => (
                <li key={x}>
                  <Check size={16} />
                  {x}
                </li>
              ))}
            </ul>
            <Link to="/login" className="button button-primary">
              Commencer mon essai <ArrowRight size={16} />
            </Link>
            <small>Sans carte bancaire. Résiliable à tout moment.</small>
          </div>
        </section>
        <section className="faq-section section-wrap">
          <div className="section-heading">
            <span className="small-label">On vous répond</span>
            <h2>Tout simplement.</h2>
            <p>Encore une question ? Les réponses sont ici.</p>
          </div>
          <div className="faq-list">
            {faqs.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing">
          <span className="closing-mark" aria-hidden="true">
            ∿
          </span>
          <h2>Faites place à votre journée.</h2>
          <p>Vos outils travaillent ensemble. Vous avancez.</p>
          <Link className="button button-primary" to="/login">
            Trouver mon accord <ArrowRight size={17} />
          </Link>
        </section>
      </main>
      <footer className="site-footer">
        <Brand />
        <span>Un peu moins de bruit. Un peu plus d’accord.</span>
        <nav>
          <Link to="/privacy">Confidentialité</Link>
          <Link to="/terms">Conditions</Link>
        </nav>
        <small>© {new Date().getFullYear()} Accord</small>
      </footer>
    </div>
  )
}
