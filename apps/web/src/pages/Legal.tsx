import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
export function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  return (
    <main className="legal-page">
      <Brand />
      <h1>{kind === 'privacy' ? 'Confidentialité' : 'Conditions d’utilisation'}</h1>
      <div className="notice">
        Document de préparation au lancement. L’identité de l’éditeur et les informations
        contractuelles doivent être finalisées avant l’ouverture commerciale.
      </div>
      {kind === 'privacy' ? (
        <>
          <h2>Les informations utilisées</h2>
          <p>
            Accord utilise les informations de votre compte, les autorisations de connexion et les
            champs des tâches et événements nécessaires aux règles que vous choisissez. Les jetons
            d’accès sont chiffrés côté serveur et ne sont pas envoyés à votre navigateur.
          </p>
          <h2>Vos choix</h2>
          <p>
            Vous pouvez mettre vos règles en pause, déconnecter vos outils et demander la
            suppression de votre compte depuis les paramètres. Les éléments déjà créés dans vos
            outils restent en place.
          </p>
          <h2>Les services associés</h2>
          <p>
            L’infrastructure utilise Cloudflare. Les paiements sont traités par Stripe. Google,
            Todoist et Notion restent soumis à leurs propres politiques de confidentialité. La durée
            de conservation, les coordonnées de l’éditeur et les modalités d’exercice de vos droits
            seront précisées avant le lancement.
          </p>
        </>
      ) : (
        <>
          <h2>Le service</h2>
          <p>
            Accord permet de créer des règles de synchronisation entre les comptes que vous
            autorisez. Les changements dépendent des disponibilités et des limites des services
            connectés. Les récurrences complexes et les séries Google étrangères ne sont pas
            automatiquement converties.
          </p>
          <h2>Abonnement et essai</h2>
          <p>
            La proposition initiale est de 6 € par mois après un essai de 14 jours sans carte. Les
            informations de taxes, de facturation, de rétractation et l’identité de l’éditeur
            devront être définies avant la mise en vente.
          </p>
          <h2>Arrêter le service</h2>
          <p>
            Mettre en pause une règle ou résilier l’abonnement n’efface pas les tâches ni les
            événements déjà synchronisés dans vos outils.
          </p>
        </>
      )}
      <p style={{ marginTop: 30 }}>
        <Link className="button button-outline" to="/">
          Retour à l’accueil
        </Link>
      </p>
    </main>
  )
}
