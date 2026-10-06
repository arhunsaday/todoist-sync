# Refondre le synchroniseur en SaaS

Date : 6 octobre 2026. Statut : direction validée par l'utilisateur ; plan d'implémentation en préparation.

## Intention et hypothèses

Créer un service payant accessible aux personnes non techniques pour synchroniser
Todoist, Notion et Google Calendar. Le propriétaire du service configure les
applications OAuth et Stripe une fois ; les clients se connectent, choisissent
leurs ressources et activent des règles depuis une interface web.

Demandes explicites : landing page soignée, abonnement mensuel Stripe,
authentification, synchronisation puissante et configurable, stack simple.

Hypothèses proposées : cible initiale individuelle, interface française,
architecture préparée pour la traduction, connexion Google au produit,
un compte connecté par fournisseur au lancement. Nom de travail : « Accord »
(nom et domaine non vérifiés). Une formule unique proposée à 6 €/mois avec
14 jours d'essai sans carte ; prix configurable côté serveur, pas encore une
décision commerciale. Pas de création d'abonnement ou de dépense pendant le cadrage.

## Diagnostic du dépôt

Le dépôt contient Hono, TypeScript, SQLite et un moteur Todoist ↔ Google.
Réutiliser les transformations, empreintes, règles de dates, protections contre
les boucles et scénarios de tests lorsque leurs invariants restent valides.

À remplacer : configuration globale par variables d'environnement, table de
jetons indexée uniquement par fournisseur, accès administrateur partagé,
SQLite local synchrone et orchestration reposant sur un verrou en mémoire.
Le moteur avance actuellement ses curseurs malgré des écritures individuelles
échouées : le nouveau moteur doit enregistrer des opérations durables à retenter.

Le code existant demeure disponible pendant la migration. La base personnelle
ne doit être ni modifiée ni importée automatiquement.

## Différenciation

La documentation Todoist actuelle décrit un calendrier de destination « Todoist »
et indique qu'un nouvel événement ne crée pas de tâche. Elle documente aussi
des limites sur les modifications d'une occurrence récurrente.

La valeur du produit : choisir le calendrier par projet ou filtre, créer des
tâches depuis les événements, connecter une source de données Notion, régler les
champs et comportements, puis comprendre chaque changement dans un journal.
Ne pas promettre une traduction universelle des récurrences ou du temps réel.

## Approches envisagées

1. **Cloudflare intégré — recommandé.** React/Vite, Tailwind, shadcn/ui ; Hono
   sur Workers ; Drizzle/D1 ; Better Auth ; Durable Objects pour sérialiser les
   traitements par utilisateur ; Queues pour les reprises ; Cron pour la
   réconciliation et le renouvellement des canaux Google. Cohérent avec le
   souhait de stack et sans serveur permanent, mais implique de porter le
   stockage synchrone et les clients vers des API asynchrones compatibles Workers.
2. **Node sur Railway.** Réutilisation plus rapide de l'exécution actuelle,
   React et PostgreSQL, file de travaux durable. Migration initiale plus courte,
   mais exploitation d'un processus permanent et stockage à faire évoluer.
3. **Services gérés assemblés.** Auth et base hébergées séparément, backend
   de synchronisation dédié. Moins de code d'infrastructure, davantage de
   fournisseurs, coûts et configuration dispersés.

Choix proposé : option 1. Vérifier Better Auth/Drizzle sur D1 local dans la
première tranche ; adapter la frontière du stockage si une incompatibilité
apparaît, sans fabriquer une authentification artisanale.

## Parcours et design

Direction visuelle : blanc ivoire, texte encre, accent vert profond, typographie
expressive pour les titres et sobre pour l'application, lignes fines et espaces
généreux. Illustrations vectorielles des flux et vraie prévisualisation du
produit. Mouvement limité aux transitions utiles ; respect du mouvement réduit.
Pas d'avis clients, logos de clients ou statistiques inventés.

- Landing : « Vos tâches et votre agenda, enfin d'accord. », démonstration d'un
  flux, bénéfices concrets, trois intégrations, fonctionnement, tarif, FAQ.
- Inscription Google : session produit distincte de l'autorisation Calendar.
- Onboarding : connecter les fournisseurs nécessaires, sélectionner les
  ressources, choisir un modèle, prévisualiser les changements, activer.
- Tableau de bord : connexions, règles actives, dernière exécution, erreurs
  nécessitant une action. État vide utile, aucune activité fictive.
- Éditeur : source → destination, filtres, champs, comportements et aperçu.
- Activité : créations, modifications, éléments ignorés, conflits et reprises.
- Paramètres : fuseau horaire, connexions, facturation Stripe, suppression du compte.

Tout fonctionne au clavier et sur mobile. Erreurs et chargements explicites.
Mode démonstration local clairement identifié, isolé des données réelles.

## Périmètre de synchronisation initial

Trois modèles : Todoist ↔ Google Calendar, Notion ↔ Google Calendar,
Todoist ↔ Notion. Chaque règle relie deux ressources. Les ressources peuvent
participer à plusieurs règles si celles-ci ne provoquent pas de cycles :
détecter les cycles avant activation, refuser les triangles bidirectionnels en V1.

Configuration : direction unique ou bidirectionnelle ; projets, sections,
étiquettes et priorité Todoist ; source de données et propriétés Notion ;
calendrier Google ; tâches datées uniquement ou journée entière ; durée par
défaut ; titre avec préfixes facultatifs ; description ; statut ; fuseau horaire.

Notion : mapping explicite titre/date/statut, et priorité si propriété compatible.
Refuser un schéma incompatible avec un message précis ; préserver les blocs de
page et les propriétés non mappées. La perte d'accès à une page ne vaut jamais
suppression de la tâche. Relecture ciblée sur webhook et balayage périodique
paginé : ne pas prétendre disposer d'un curseur global équivalent à Todoist.

Conflits : comparaison par champ à la dernière version commune. Fusionner les
champs indépendants ; en cas de modification simultanée du même champ,
appliquer la préférence choisie (source ou destination) ou demander une résolution.
Politique par défaut : résolution manuelle, paire suspendue, autres paires actives.

Suppression d'un événement : dissocier par défaut ; terminer la tâche uniquement
sur choix explicite. Une tâche terminée conserve par défaut un événement marqué
comme terminé ; retrait de l'événement possible. Aucune suppression définitive
de tâche Todoist. Barrière configurable avant mutations massives.

Récurrences Todoist : synchroniser l'occurrence actuelle comme événement simple,
puis déplacer/créer son miroir lorsque Todoist fournit la suivante. Ne pas
réécrire la règle de récurrence à partir d'un déplacement Google. Les séries
Google étrangères sont exclues avec explication visible. Pas de récurrence
Notion implicite. Pas d'auto-planification ou d'IA dans cette version.

## Modèle de données et frontières

D1 : tables d'authentification ; connections ; rules et rule_versions ;
entity_links ; sync_cursors ; operations ; runs ; activity ; subscriptions ;
webhook_receipts. Toutes les données métier portent user_id ; contraintes
uniques incluant propriétaire, connexion, ressource et identifiant fournisseur.

Les liens d'entités utilisent un identifiant de groupe commun pour empêcher
qu'une chaîne de règles autorisée crée des doublons. Une seule règle possède
l'écriture d'un champ sur une paire ; refuser les règles superposées ambiguës.

Modules séparés : auth, billing, connections, rules, providers, reconciliation,
storage, jobs et application web. Adaptateurs fournisseurs : découverte des
ressources, lecture des changements, normalisation, écriture et capacités.
Le moteur produit des opérations à partir des états ; les adaptateurs les exécutent.

## Fiabilité et sécurité concrètes

Webhooks vérifiés sur corps brut, attribution à la connexion par identifiants
fournisseur validés et abonnements enregistrés ; aucune confiance dans user_id
envoyé par le client. Réception persistée avant réponse et traitement asynchrone.
Cloudflare Queues peut livrer plusieurs fois : déduplication et idempotence requises.

Orchestration par utilisateur dans un Durable Object. Persister les opérations
avant d'avancer les curseurs, avec révision de règle et version des données.
Après crash entre écriture externe et accusé local, rechercher le miroir grâce
à une clé stable avant de recréer ; exploiter les mécanismes d'idempotence natifs
du fournisseur lorsqu'ils existent. Ne pas revendiquer d'exécution exactement une fois.

Reprises avec délai progressif, respect de Retry-After, plafond, état d'échec
consultable et relance manuelle. Reprendre depuis les données courantes si la
révision a changé ; ne pas rejouer un ancien changement sur une version récente.
Renouvellement Google, refresh OAuth et révocation rendent la connexion
« à reconnecter » sans arrêter celles des autres utilisateurs.

Sessions HttpOnly/Secure ; validation d'origine ; OAuth state à usage unique
lié à la session, PKCE lorsque pris en charge ; jetons chiffrés par AES-GCM avec
clé dans les secrets Workers et identifiant de version de clé. Tokens jamais
exposés au navigateur ou aux logs. Rafraîchissement sérialisé par connexion.
Déconnexion suspend les règles concernées et invalide les opérations en attente.

## Abonnement

Stripe Checkout pour souscrire et Customer Portal pour gérer l'abonnement.
Un utilisateur peut configurer et prévisualiser sans payer ; activer exige
un essai valable ou un abonnement autorisé côté serveur.

Essai de 14 jours créé une seule fois dans l'application à l'inscription,
sans abonnement Stripe initial. Le passage payant ouvre Checkout. États
active/trialing autorisent l'exécution ; past_due dispose d'un délai de grâce
de 3 jours ; unpaid/canceled après fin de période suspendent les écritures.
Une résiliation en fin de période conserve l'accès jusqu'à cette date.

Les webhooks Stripe signés et dédupliqués déclenchent une relecture de
l'abonnement actuel pour éviter les régressions dues à l'ordre des événements.
Le retour Checkout ne suffit pas à activer l'accès. Vérifier le droit d'accès
également dans les workers de synchronisation. La suspension laisse les
éléments externes existants en place.

## Migration, livraison et validation

Tranches successives, chacune vérifiable :

1. Socle Workers/D1, landing et parcours de démonstration identifiés.
2. Auth, isolation utilisateurs, OAuth et découverte des ressources.
3. Règles et aperçu ; Todoist ↔ Google réel avec opérations durables.
4. Notion et mapping de propriétés ; scénarios des trois paires.
5. Stripe, essai et contrôle d'accès dans API et travaux asynchrones.
6. Vérification navigateur, tests de panne, documentation et préparation production.

Conserver l'ancien service comme entrée legacy jusqu'à la parité du nouveau
Todoist ↔ Google. Migration personnelle optionnelle et explicite, sauvegarde
préalable et adoption des miroirs existants. Ne pas exécuter les deux moteurs
sur les mêmes ressources pendant la transition.

Critères : deux utilisateurs ne peuvent lire ni modifier les données de l'autre ;
prévisualisation sans écriture externe ; activation puis modification dans chaque
sens sans boucle ; aucune duplication après webhook répété ou crash ; échec API
retenté malgré avance du curseur ; dates et changements d'heure corrects ; conflit
visible ; pause et fin d'essai respectées par les travaux déjà en attente ;
paiement testé en environnement Stripe test ; navigation mobile et clavier.

Tests unitaires du moteur et des règles, intégration stockage/OAuth/webhooks,
tests navigateur des parcours et essais réels avec comptes dédiés. Les mocks
ne constituent pas une validation réelle des fournisseurs.

Mise en ligne réelle nécessite domaine, applications OAuth du propriétaire,
configuration Cloudflare et Stripe, textes légaux adaptés et validation Google
des scopes concernés. Leur absence permet de livrer et tester localement le
code, pas d'annoncer un service commercial opérationnel.

## Sources consultées

- [Intégration officielle Todoist](https://www.todoist.com/fr/help/todoist/integrations/use-the-calendar-integration-rCqwLCt3G)
- [Inspiration demandée](https://todoist-sync.com/)
- [Cloudflare Vite](https://developers.cloudflare.com/workers/vite-plugin/)
- [Cloudflare stockage](https://developers.cloudflare.com/workers/platform/storage-options/)
- [Garanties Queues](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Better Auth et Drizzle](https://better-auth.com/docs/adapters/drizzle)
- [Notion OAuth](https://developers.notion.com/guides/get-started/authorization)
- [Notion webhooks](https://developers.notion.com/reference/webhooks)
- [Notion data sources](https://developers.notion.com/reference/query-a-data-source)
- [Stripe abonnements et webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Google vérification des scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
