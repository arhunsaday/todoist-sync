import { Link } from 'react-router-dom'
import { legal, legalReady } from '@accord/domain'
import { Brand } from '../components/Brand'
const value = (text: string) => text || 'À renseigner avant publication'
export function Legal({ kind }: { kind: 'privacy' | 'terms' | 'notice' }) {
  return (
    <main className="legal-page">
      <Brand />
      <h1>
        {kind === 'privacy'
          ? 'Politique de confidentialité'
          : kind === 'notice'
            ? 'Mentions légales'
            : 'Conditions d’utilisation et de vente'}
      </h1>
      {!legalReady() && (
        <div className="notice">
          Version de préparation. Les informations de l’éditeur et les conditions commerciales sont
          encore à compléter. Les paiements réels sont désactivés tant que cette version n’est pas
          validée.
        </div>
      )}
      <p>
        Version du {legal.version}. Contact : {value(legal.contact)}.
      </p>
      <nav aria-label="Documents légaux">
        <Link to="/legal">Mentions légales</Link> · <Link to="/privacy">Confidentialité</Link> ·{' '}
        <Link to="/terms">Conditions</Link>
      </nav>
      {kind === 'notice' ? (
        <>
          <h2>Éditeur et publication</h2>
          <p>
            Accord est édité par {value(legal.publisher)}. Statut : {value(legal.status)}. Pays
            d’établissement : {value(legal.country)}. Adresse : {value(legal.address)}.
          </p>
          <p>
            Immatriculation et numéro de TVA, lorsqu’ils sont applicables :{' '}
            {value(legal.registration)} ; {value(legal.vat)}. Directeur de la publication :{' '}
            {value(legal.director)}.
          </p>
          <h2>Hébergement</h2>
          <p>
            Le service utilise Cloudflare Workers et D1. Les coordonnées légales actuelles de
            l’hébergeur et les informations de contact sont disponibles sur{' '}
            <a href="https://www.cloudflare.com/privacypolicy/">le site de Cloudflare</a>.{' '}
            {value(legal.hostingNotice)}.
          </p>
          <h2>Propriété intellectuelle et contact</h2>
          <p>
            Les marques Todoist, Notion, Google et Stripe appartiennent à leurs titulaires. Accord
            est un service indépendant. Pour une question, une réclamation ou un signalement, écrire
            à {value(legal.contact)}.
          </p>
        </>
      ) : kind === 'privacy' ? (
        <>
          <h2>Responsable du traitement</h2>
          <p>
            {value(legal.publisher)}, établi à {value(legal.address)}, détermine les finalités et
            les moyens des traitements nécessaires au service. Pour les demandes relatives aux
            données personnelles : {value(legal.contact)}.
          </p>
          <h2>Données et finalités</h2>
          <p>
            Nous utilisons votre identifiant Google, nom, email et image de compte pour vous
            identifier ; des sessions pour sécuriser votre accès ; les identifiants des comptes
            connectés et leurs autorisations chiffrées pour synchroniser les ressources choisies.
          </p>
          <p>
            Les règles, propriétés Notion, titres, descriptions, dates, priorités, états et
            commentaires activés dans vos règles servent à calculer et appliquer les changements.
            Les liens entre éléments, curseurs, opérations et aperçus permettent les reprises après
            erreur. L’activité peut contenir un titre de tâche ; évitez d’y enregistrer des données
            sensibles inutiles.
          </p>
          <p>
            Les références client et abonnement Stripe servent à gérer votre accès payant. Stripe
            collecte les informations de paiement dans son interface ; Accord ne reçoit pas votre
            numéro de carte complet. Les informations techniques de connexion et journaux
            d’infrastructure servent à la sécurité et au diagnostic.
          </p>
          <h2>Bases juridiques</h2>
          <p>
            L’identification, les synchronisations choisies et la gestion de l’abonnement sont
            nécessaires à l’exécution du service demandé. La sécurité et la prévention des
            renouvellements abusifs d’essai reposent sur l’intérêt légitime de l’éditeur, sous
            réserve de vos droits. La conservation des pièces comptables relève des obligations
            légales applicables. L’autorisation OAuth peut être retirée depuis Accord ou chez le
            fournisseur.
          </p>
          <h2>Destinataires et transferts</h2>
          <p>
            L’éditeur et les personnes habilitées accèdent aux données nécessaires. Cloudflare
            fournit l’hébergement ; Stripe traite les paiements. Google, Todoist et Notion reçoivent
            les requêtes et les champs nécessaires à vos règles et appliquent leurs propres
            politiques. Nous ne vendons pas vos données.
          </p>
          <p>
            Encadrement des transferts hors Espace économique européen, contrats et localisation
            retenue : {value(legal.transfersNotice)}. Ne pas présumer que toutes les données restent
            dans l’Union européenne : les fournisseurs et leurs sous-traitants peuvent intervenir
            dans plusieurs pays.
          </p>
          <h2>Conservation et suppression</h2>
          <p>
            Compte, connexions, règles et liens sont conservés jusqu’à leur suppression. L’activité
            est purgée après 90 jours ; les reçus de webhooks et événements Stripe traités après 30
            jours. Les autorisations OAuth temporaires et aperçus expirés sont purgés par le
            traitement périodique.
          </p>
          <p>
            Après suppression du compte, une empreinte de l’email, calculée avec un secret du
            service, reste au maximum 365 jours pour éviter de renouveler indéfiniment l’essai. Elle
            n’est pas un anonymat irréversible. Une suppression peut rester en attente si
            l’annulation Stripe échoue ; les sessions sont invalidées et la synchronisation arrêtée
            dès le début.
          </p>
          <p>
            Les sauvegardes exportées sont conservées {legal.backupRetentionDays} jours selon la
            procédure d’exploitation ; leur accès est restreint et elles sont chiffrées. La fenêtre
            de restauration D1 dépend du plan Cloudflare. Les données supprimées peuvent subsister
            dans cette fenêtre ; elles doivent être supprimées à nouveau après une restauration.
            Pièces comptables : {value(legal.accountingRetentionNotice)}.
          </p>
          <h2>Cookies et stockage local</h2>
          <p>
            Les cookies de session et de sécurité sont nécessaires à la connexion. La démonstration
            conserve ses règles dans le stockage local de votre navigateur et permet de les
            réinitialiser. L’application n’installe pas de traceurs publicitaires. Tout ajout
            d’outil de mesure ou de marketing nécessitera une nouvelle information et, si
            nécessaire, votre consentement.
          </p>
          <h2>Vos droits</h2>
          <p>
            Vous pouvez demander l’accès, la rectification, l’effacement, la limitation et, dans les
            cas prévus, la portabilité de vos données, ou vous opposer aux traitements fondés sur
            l’intérêt légitime. Écrivez à {value(legal.contact)}. Une vérification d’identité
            proportionnée peut être nécessaire. Une réponse est apportée en principe sous un mois,
            avec prolongation motivée dans les cas prévus par la réglementation.
          </p>
          <p>
            Vous pouvez adresser une réclamation à l’autorité compétente ; en France, à la{' '}
            <a href="https://www.cnil.fr/fr/plaintes">CNIL</a>. La suppression de votre compte
            n’efface pas les objets déjà créés dans vos outils.
          </p>
          <h2>Données Google</h2>
          <p>
            Les données obtenues via Google sont utilisées pour fournir les fonctions de
            synchronisation visibles dans Accord, sans publicité ni revente. Leur utilisation et
            leur transfert respectent la{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </a>
            , y compris ses exigences Limited Use. Aucun entraînement de modèle d’IA n’utilise ces
            données.
          </p>
        </>
      ) : (
        <>
          <h2>Parties et objet</h2>
          <p>
            Ces conditions régissent Accord, fourni par {value(legal.publisher)} à{' '}
            {value(legal.address)}. Public visé : {value(legal.audience)}. Le service permet de
            synchroniser des ressources Todoist, Notion et Google Agenda selon vos règles et
            autorisations.
          </p>
          <h2>Compte et autorisations</h2>
          <p>
            Vous devez disposer du droit d’accéder et de modifier les ressources connectées.
            Protégez votre compte Google et prévenez le support en cas d’accès suspect. Les usages
            illicites, les tentatives d’accès aux comptes d’autrui et le contournement des limites
            sont interdits.
          </p>
          <h2>Fonctionnement et précautions</h2>
          <p>
            L’aperçu présente les décisions avant activation ; vérifiez les ressources, filtres,
            champs, fuseaux et politiques de conflit. Les écritures peuvent modifier ou retirer des
            événements selon vos choix. Vous restez maître des autorisations et devez conserver une
            sauvegarde des informations importantes.
          </p>
          <p>
            Le service dépend des API externes et de leurs quotas : aucun délai temps réel n’est
            garanti. La V1 connecte un compte de chaque fournisseur, refuse les cycles de règles et
            ne transforme pas les séries Google étrangères. La récurrence Todoist concerne
            l’occurrence actuelle ; les créations Notion demandent une propriété Accord ID.
            L’éditeur traite les erreurs signalées et fournit les mises à jour nécessaires au
            maintien du service.
          </p>
          <h2>Essai, commande et prix</h2>
          <p>
            L’essai dure 14 jours sans carte, une fois par identité selon la politique du service.
            Il ne se transforme pas automatiquement en abonnement. La souscription est un acte
            distinct dans Stripe Checkout ; le prix mensuel est indiqué avant paiement. Régime de
            taxes : {value(legal.taxNotice)}.
          </p>
          <p>
            L’abonnement est mensuel et renouvelé jusqu’à résiliation. Les factures et le moyen de
            paiement sont accessibles depuis Facturation. L’accès payant commence après confirmation
            serveur de l’abonnement. Les conditions applicables et leur version sont accessibles
            avant commande.
          </p>
          <h2>Résiliation, incidents de paiement et compte</h2>
          <p>
            Vous pouvez résilier depuis Facturation via le portail Stripe. La résiliation prend
            effet à la fin de la période payée ; elle arrête les renouvellements. Un paiement en
            retard bénéficie d’une grâce de trois jours, puis les écritures sont suspendues. La
            pause d’une règle ou la déconnexion d’un outil ne résilie pas l’abonnement.
          </p>
          <p>
            La suppression du compte arrête la synchronisation et demande l’annulation de
            l’abonnement ; les éléments externes restent en place. Si l’annulation échoue, la
            suppression reste en attente et doit être reprise. Contactez le support pour tout
            incident.
          </p>
          <h2>Consommateurs : rétractation et garanties</h2>
          <p>
            Lorsque la loi applicable vous accorde un droit de rétractation, vous disposez de 14
            jours à compter de la conclusion du contrat. Vous pouvez envoyer une déclaration non
            ambiguë à {value(legal.contact)}, en indiquant votre email de compte, la date de
            souscription et votre demande de rétractation. Aucune renonciation à ce droit n’est
            présumée par ces conditions.
          </p>
          <p>
            Modèle : « Je vous notifie ma rétractation du contrat Accord souscrit le [date], au nom
            de [nom], pour le compte [email]. Adresse : [adresse]. Date : [date]. »{' '}
            {value(legal.withdrawalNotice)}.
          </p>
          <p>
            Ces conditions n’écartent pas les garanties légales obligatoires, notamment celles
            relatives à la conformité des services numériques lorsqu’elles s’appliquent.{' '}
            {value(legal.guaranteeNotice)}.
          </p>
          <h2>Réclamations, médiation et litiges</h2>
          <p>
            Contactez d’abord {value(legal.contact)}. Pour les consommateurs, après une réclamation
            écrite non résolue, médiateur désigné : {value(legal.mediatorName)},{' '}
            {value(legal.mediatorAddress)}, {value(legal.mediatorUrl)}. Les droits impératifs et les
            voies de recours du consommateur restent applicables ; aucune compétence exclusive ne
            leur est imposée.
          </p>
          <h2>Évolution du service</h2>
          <p>
            Une évolution substantielle des conditions ou du prix est annoncée avant son
            application, avec les possibilités de résiliation requises. Une modification ne
            s’applique pas rétroactivement à une période déjà payée. Les conditions ne limitent pas
            la responsabilité lorsque la loi interdit une telle limitation.
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
