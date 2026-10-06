# Configurer Accord

La configuration ci-dessous concerne le propriétaire du service. Les utilisateurs
se connectent ensuite depuis le navigateur ; ils n’installent rien et ne créent
pas d’applications OAuth.

## Développement local

Installer les dépendances avec la version pnpm indiquée dans `package.json`,
puis `pnpm db:local` et `pnpm dev:saas`. Vite et Wrangler partagent le dossier
`.wrangler/state` à la racine pour éviter deux bases de développement différentes.
Les tests Workers disposent de leur propre stockage isolé.

Secrets dans `apps/worker/.dev.vars` (fichier ignoré par Git). Générer les valeurs :

```sh
openssl rand -base64 32
```

Une génération pour `BETTER_AUTH_SECRET`, une autre pour `TOKEN_ENCRYPTION_KEY`.
La seconde valeur représente exactement 32 octets en base64. Elle chiffre les
jetons fournisseurs par AES-GCM avec utilisateur, connexion et fournisseur comme
contexte authentifié. Les enveloppes portent une version. Ne pas changer cette
clé sans migrer les jetons ou reconnecter les comptes.

## Google

Créer un projet Google Cloud et activer Calendar API. Créer un client OAuth web.
Configurer l’écran de consentement et ajouter ces redirections :

- `<PUBLIC_URL>/api/auth/callback/google` pour la connexion au produit.
- `<PUBLIC_URL>/api/connections/google/callback` pour le calendrier.

Renseigner `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`. Le parcours Calendar
utilise PKCE, demande un accès hors ligne et les scopes `calendar.events` et
`calendar.calendarlist.readonly`. La connexion au produit demande seulement les
informations d’identité. Les deux autorisations sont distinctes.

Un service public doit suivre les [règles Google OAuth](https://developers.google.com/identity/protocols/oauth2/policies)
et les exigences de [vérification des scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
Les canaux de notifications sont créés automatiquement pour les calendriers des
règles actives lorsque `PUBLIC_URL` utilise HTTPS ; aucune notification Google
n’est tentée contre localhost.

## Todoist

Créer une application Todoist et renseigner `TODOIST_CLIENT_ID` et
`TODOIST_CLIENT_SECRET`. Redirection :
`<PUBLIC_URL>/api/connections/todoist/callback`. Webhook :
`<PUBLIC_URL>/api/webhooks/todoist`.

Activer les événements de tâches et de commentaires utiles au service. Le scope
est `data:read_write`, jamais `data:delete`. Le corps brut des notifications est
vérifié par HMAC avec le secret de l’application ; les identifiants externes sont
associés aux connexions stockées, pas aux comptes envoyés librement par le client.

## Notion

Créer une connexion publique avec lecture/insertion/mise à jour de contenu.
Redirection : `<PUBLIC_URL>/api/connections/notion/callback`. Renseigner
`NOTION_CLIENT_ID` et `NOTION_CLIENT_SECRET`. Le client utilise l’API versionnée
`2025-09-03` et les data sources. Partager explicitement les ressources nécessaires
lors de l’autorisation. Ajouter une propriété texte dédiée **Accord ID** pour les
créations récupérables après perte de réponse.

Le balayage périodique fonctionne sans webhook. Pour activer les notifications :

1. Générer un secret temporaire `NOTION_HANDSHAKE_KEY` et le configurer dans Workers.
2. Créer la subscription Notion avec l’URL
   `<PUBLIC_URL>/api/webhooks/notion?setup=<secret-temporaire>`.
3. Le premier challenge est chiffré dans la table `provider_secrets`. Son insertion
   ne peut pas écraser un challenge existant.
4. Exporter la ligne `encrypted_value` avec Wrangler dans un fichier JSON local,
   puis utiliser `TOKEN_ENCRYPTION_KEY` et le script `scripts/notion-verification.mjs`
   pour obtenir le jeton à coller dans l’écran de vérification Notion. Ce script
   est destiné au propriétaire, pas aux utilisateurs ; utiliser un terminal privé.
5. Retirer `NOTION_HANDSHAKE_KEY` après validation. Les notifications régulières
   sont vérifiées par `X-Notion-Signature` avec le challenge stocké chiffré.

On peut aussi fournir `NOTION_WEBHOOK_SECRET` lorsque la subscription est déjà
vérifiée. Ne pas publier de jeton dans une issue, des logs ou le navigateur.

## Stripe

Configurer Stripe en mode test avant le mode live. Créer un produit récurrent
mensuel et renseigner `STRIPE_PRICE_ID`. Le montant et la devise du Price doivent
correspondre à `STRIPE_PRICE_AMOUNT` (par défaut `6`) et
`STRIPE_PRICE_CURRENCY` (`EUR`). Checkout refuse une discordance.

Secrets : `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET`. Endpoint :
`<PUBLIC_URL>/api/webhooks/stripe`. Événements :
`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`.
Configurer aussi le Customer Portal pour la gestion des factures et résiliations.

L’essai est créé dans l’application sans carte. Le retour Checkout n’accorde
aucun accès à lui seul. Les événements Stripe sont enregistrés puis traités en
relisant l’abonnement actuel. Une résiliation conserve l’accès jusqu’à la fin de
période ; `past_due` conserve une grâce de trois jours sans la renouveler à
chaque notification. `unpaid` et `canceled` suspendent les écritures.

## Cloudflare

Les commandes suivantes provisionnent des ressources réelles ; elles sont à
exécuter par le propriétaire lorsqu’il souhaite mettre l’instance en ligne.

```sh
pnpm --filter @accord/worker exec wrangler login
pnpm --filter @accord/worker exec wrangler d1 create accord-production
pnpm --filter @accord/worker exec wrangler queues create accord-sync
```

Remplacer le database_id local dans `apps/worker/wrangler.jsonc`, définir le
nom de la base de production, puis définir `PUBLIC_URL` sur l’origine HTTPS
réelle. Conserver le binding `DB`, le binding `SYNC_QUEUE` et le binding Durable
Object `SYNC_COORDINATOR`. Les migrations Durable Objects sont déclarées dans
le fichier. Configurer les secrets avec `wrangler secret put` ; ne pas les mettre
dans `vars` ou dans Git.

```sh
pnpm --filter @accord/worker exec wrangler d1 migrations apply accord-production --remote
pnpm build:saas
pnpm --filter @accord/worker exec wrangler deploy --config ../web/dist/client/accord/wrangler.json
```

Connecter le domaine, vérifier les URL OAuth et les webhooks, puis exécuter les
scénarios avec comptes dédiés décrits dans `validation.md`. Finaliser conditions,
confidentialité, identité de l’éditeur, montant/taxes et obligations commerciales
avant d’ouvrir le paiement au public.

## Exploitation

- Sauvegarder D1 et activer une procédure de restauration vérifiée avant ouverture.
- Ne pas effacer D1 pour « resynchroniser » : elle contient les utilisateurs,
  autorisations, abonnements et opérations durables.
- En cas d’erreur API, consulter Activité ; réautoriser une connexion ou relancer
  la règle après résolution du problème. Les autres utilisateurs continuent.
- Une règle bloquée par le seuil se débloque par aperçu puis confirmation explicite.
- Les créations Notion à résultat ambigu restent en vérification. Une relance
  recherche leur Accord ID ; elle ne recrée pas aveuglément une page.
- Retention : activité 90 jours ; reçus et événements Stripe traités 30 jours ;
  empreinte anti-renouvellement d’essai 365 jours. Les tentatives OAuth et aperçus
  expirés sont purgés par Cron. Les liens restent tant que la règle existe.
- Restaurer une version Worker antérieure nécessite un schéma compatible ; les
  migrations SQL publiées sont ajoutées, pas réécrites. Tester restauration et
  rollback sur une instance dédiée avant incident.
