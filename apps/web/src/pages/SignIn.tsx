import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Brand } from '../components/Brand'
import { Button } from '../components/ui/button'
import { api, post } from '../lib/api'
export function SignIn() {
  const [available, setAvailable] = useState<boolean | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  useEffect(() => {
    api<{ googleAuth: boolean }>('/config')
      .then((x) => setAvailable(x.googleAuth))
      .catch(() => setAvailable(false))
    api<{ user: unknown }>('/session')
      .then((r) => {
        if (r.user) navigate('/app')
      })
      .catch(() => {})
  }, [navigate])
  async function login() {
    setBusy(true)
    try {
      const r = await post<{ url: string }>('/auth/sign-in/social', {
        provider: 'google',
        callbackURL: location.origin + '/app',
      })
      location.assign(r.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion indisponible')
      setBusy(false)
    }
  }
  return (
    <main className="auth-page">
      <aside className="auth-aside">
        <Brand />
        <div>
          <h1>
            Une journée
            <br />
            qui vous ressemble.
          </h1>
          <p>
            Vos listes, vos projets, votre agenda.
            <br />
            Un espace pour les faire travailler ensemble.
          </p>
        </div>
        <p className="muted">Moins d’allers-retours. Plus d’accord.</p>
      </aside>
      <section className="auth-main">
        <div className="auth-card">
          <Link className="back-link" to="/">
            <ArrowLeft size={14} /> Retour à l’accueil
          </Link>
          <h2>Trouvez votre accord.</h2>
          <p className="muted">
            Connectez-vous pour commencer vos 14 jours d’essai. Aucune carte bancaire nécessaire.
          </p>
          {available === false && (
            <div className="notice">
              La connexion Google n’est pas encore configurée sur cette instance. Vous pouvez
              explorer le produit dans la démonstration.
            </div>
          )}
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <Button onClick={login} disabled={!available || busy}>
            {busy ? 'Connexion…' : 'Continuer avec Google'} <ArrowRight size={16} />
          </Button>
          <Link className="button button-outline" to="/demo">
            Explorer la démonstration
          </Link>
          <p className="auth-fineprint">
            En continuant, vous acceptez les <Link to="/terms">conditions d’utilisation</Link> et la{' '}
            <Link to="/privacy">politique de confidentialité</Link>.
          </p>
        </div>
      </section>
    </main>
  )
}
