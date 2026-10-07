# Préparer la mise en service

Ce dossier prépare une instance HTTPS et Stripe test. Il ne crée pas de ressources
à votre insu et ne remplace pas la recette avec comptes réels.

## 1. Assistant opérateur

À la racine du worktree :

```sh
pnpm setup:service
```

Sept étapes : origine HTTPS, D1/Queue, clés internes, Google, Todoist, Notion,
Stripe sandbox. Les secrets sont saisis sans affichage. L’assistant écrit
`apps/worker/.dev.vars.production`, génère `wrangler.production.json` et
`.dev.vars.upload.json`, tous ignorés par Git. Il conserve les clés internes sur
réexécution ; aucune valeur n’est envoyée dans un chat ni dans GitHub.

Ne pas utiliser `set -x` ou enregistrer le terminal. Protéger les fichiers par
permissions et coffre de secrets. La configuration locale et le `.env` legacy
restent indépendants. Le fichier upload contient des secrets en clair : le
supprimer après chargement, conserver les clés dans un coffre.

La création de D1 et Queue se fait dans votre terminal via les commandes affichées.
Cloudflare peut exiger un plan payant pour les ressources choisies : vérifier
les conditions du compte avant de les créer.

## 2. Construire, migrer et déployer l’instance test

Les commandes suivantes agissent sur le compte Cloudflare connecté. Vérifier
le nom de base et son identifiant dans le fichier généré avant de les exécuter.

```sh
pnpm --filter @accord/worker exec wrangler d1 migrations apply accord-production --remote --config wrangler.production.json
ACCORD_WRANGLER_CONFIG=../worker/wrangler.production.json pnpm build:saas
pnpm --filter @accord/worker exec wrangler deploy --config ../web/dist/client/accord/wrangler.json
pnpm --filter @accord/worker exec wrangler secret bulk .dev.vars.upload.json --config wrangler.production.json
```

Remplacer `accord-production` si vous avez choisi un autre nom. Le build doit
utiliser la configuration production ; un build local utilise une base factice
et une origine localhost. Les secrets se chargent dans le Worker, pas dans les
assets. Aucun secret `VITE_*` n’est nécessaire.

Connecter le domaine au Worker depuis Cloudflare, puis vérifier que l’origine
réelle correspond exactement à `PUBLIC_URL`. Si elle change, régénérer la
configuration, reconstruire, déployer et ajuster toutes les redirections OAuth.

```sh
curl --fail https://VOTRE-ORIGINE/api/health
```

## 3. Paramètres fournisseurs

| Service         | Redirection / endpoint              | À vérifier                                                                      |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| Google identité | `/api/auth/callback/google`         | Client web, openid/email/profile, testeurs                                      |
| Google Agenda   | `/api/connections/google/callback`  | Calendar API, calendar.events, calendar.calendarlist.readonly, accès hors ligne |
| Todoist         | `/api/connections/todoist/callback` | data:read_write, pas data:delete                                                |
| Todoist webhook | `/api/webhooks/todoist`             | Tâches/commentaires, secret application                                         |
| Notion OAuth    | `/api/connections/notion/callback`  | Connexion publique, capacités lecture/insertion/mise à jour, pages partagées    |
| Notion webhook  | `/api/webhooks/notion`              | Handshake facultatif décrit dans deployment.md                                  |
| Stripe          | `/api/webhooks/stripe`              | checkout.session.completed ; customer.subscription.created/updated/deleted      |

Les chemins sont préfixés par l’origine HTTPS. Renseigner logo, contact, homepage,
confidentialité et conditions dans les applications publiques. Google doit être
publié/vérifié pour les scopes concernés avant diffusion au public ; les tokens
de refresh des applications en test peuvent avoir une durée limitée selon Google.

Stripe : créer un Price récurrent mensuel dont montant/devise correspondent aux
variables ; activer dans le portail client factures, modification du moyen de
paiement et résiliation en fin de période. Renseigner les URLs légales dans les
informations publiques Stripe pour la case d’acceptation obligatoire Checkout.
Activer les emails de confirmation/reçu selon le besoin contractuel et vérifier
leur contenu. Définir TVA, territoire et éventuelle collecte fiscale avant live :
l’application ne calcule pas automatiquement la TVA.

## 4. Recette minimale avec comptes dédiés

- Google : connexion, déconnexion, reconnexion, session expirée ; compte B ne voit
  pas les règles du compte A.
- Chaque paire d’outils : créer, déplacer date, changer titre, terminer/réouvrir,
  conflit, choix d’un côté, pause, reprise, retrait d’autorisation fournisseur.
- Notion : retirer une propriété mappée puis vérifier l’arrêt, pas une suppression
  de dates ; création interrompue et reprise sans doublon.
- Google : journées entières, changement d’heure, suppression manuelle, déplacement
  entre calendriers mappés, récurrence Todoist.
- Stripe test : Checkout, confirmation serveur, double notification, renouvellement,
  paiement échoué, résiliation fin de période et suppression du compte.
- Tester webhooks sur HTTPS et rattrapage périodique après notification perdue.
- Vérifier légal, sauvegarde/restauration et reprise contrôlée selon backup-restore.md.

Consigner date, compte de test et résultat ; ne pas utiliser de données personnelles
réelles inutiles. Ne pas basculer live sur la seule base des tests simulés.

## 5. Passage au paiement réel

Compléter `packages/domain/src/legal.ts` et le dossier legal/publication.md,
valider les textes selon l’établissement et les marchés retenus, puis mettre
`approved: true`. L’absence d’approbation bloque Checkout avec `sk_live_*`.
Cette garde n’est pas une certification juridique : le propriétaire reste
responsable des informations, contrats fournisseurs et parcours de vente.

Recréer produit/Price, portail et webhook dans l’environnement Stripe live ;
les identifiants et secrets de test ne sont pas valables en live. Charger les
secrets live directement par `wrangler secret put` et mettre à jour montant/devise
si nécessaire. L’assistant refuse volontairement les clés live pendant la préparation.
Ne pas effacer les clés de chiffrement lors de cette bascule.

Références : [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[Notion OAuth](https://developers.notion.com/guides/get-started/authorization),
[Stripe Checkout](https://docs.stripe.com/payments/checkout),
[Cloudflare D1](https://developers.cloudflare.com/d1/get-started/).
