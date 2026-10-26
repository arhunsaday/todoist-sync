# Accord

Vos tâches et votre agenda, enfin d’accord. Accord transforme ce dépôt de
synchronisation personnelle en application web pour Todoist, Notion et Google
Agenda : comptes individuels, règles visuelles, aperçu avant activation,
historique, gestion des conflits et abonnement mensuel Stripe.

## Essayer localement

Node.js 22.17 ou plus récent et pnpm 10.34.6.

```sh
corepack pnpm install --frozen-lockfile
pnpm db:local
pnpm dev:saas
```

Ouvrir [la landing](http://127.0.0.1:5173/) ou
[la démonstration](http://127.0.0.1:5173/demo). La démonstration utilise des
exemples isolés dans le navigateur ; elle ne contacte pas vos outils.

Sans identifiants OAuth, la landing et la démonstration sont utilisables,
mais la connexion réelle indique explicitement que l’instance est à configurer.
Copier `apps/worker/.dev.vars.example` vers `apps/worker/.dev.vars` pour renseigner
les secrets de développement. Ne jamais utiliser le `.env` personnel legacy.

## Ce que contient le produit

- Landing responsive et interface française, polices hébergées localement.
- Connexion Google avec Better Auth, sessions persistées dans D1.
- Connexions OAuth distinctes à Todoist, Google Agenda et Notion.
- Règles entre deux ressources, direction unique ou bidirectionnelle.
- Filtres de projets, sections, étiquettes, priorités et tâches datées.
- Mapping des propriétés Notion par identifiant stable.
- Durée, fuseau horaire, journées entières, préfixes et commentaires Todoist.
- Prévisualisation, protection des lots importants, pause, reprise et conflits.
- Travaux durables, reprises automatiques et prévention des écritures en double.
- Essai de 14 jours sans carte ; Checkout et portail client Stripe.
- Reprise explicite des événements créés par l’ancien synchroniseur.

Les opérations réelles nécessitent les applications OAuth et la configuration
Stripe du propriétaire du service. Les tests locaux utilisent des réponses
fournisseurs simulées ; ils ne remplacent pas les essais avec comptes dédiés.

## Architecture

| Répertoire           | Responsabilité                                                  |
| -------------------- | --------------------------------------------------------------- |
| `apps/web`           | React, Vite, Tailwind et composants shadcn/Radix                |
| `apps/worker`        | Hono, Better Auth, D1, OAuth, facturation et traitements        |
| `packages/domain`    | Contrats Zod, filtres, conflits et décisions de synchronisation |
| `packages/providers` | Clients HTTP Todoist, Notion et Google Agenda                   |
| `src`                | Service Node personnel conservé pendant la migration            |

Un Durable Object par utilisateur sérialise les changements. D1 conserve les
opérations avant l’avancement des curseurs. Queues et les alarmes relancent les
travaux ; Cron rattrape les notifications perdues toutes les 15 minutes.
Les jetons sont chiffrés et les API métier imposent l’utilisateur de la session.

## Vérifier et construire

```sh
pnpm test:saas
pnpm test:worker
pnpm typecheck:saas
pnpm test:browser
pnpm build:saas
```

Le build produit le Worker et ses assets dans `apps/web/dist/client/`.
Les configurations de déploiement générées se trouvent dans
`apps/web/dist/client/accord/wrangler.json`.

Le service personnel conserve ses commandes `pnpm dev`, `pnpm test`,
`pnpm build`, `pnpm start` et sa base SQLite. Sa documentation se trouve dans
[README.legacy.md](README.legacy.md).

## Mise en service

Un assistant guidé prépare OAuth, Stripe test et Cloudflare : `pnpm setup:service`.
Il ne déploie rien automatiquement. La configuration privée reste hors Git.
L’exercice `pnpm backup:drill` vérifie export/restauration de fixtures D1 isolées.

- [Assistant et lancement](docs/launch.md)
- [Sauvegarder et restaurer](docs/backup-restore.md)
- [Informations légales à compléter](docs/legal/publication.md)

- [Configurer et déployer](docs/deployment.md)
- [Utiliser les règles](docs/user-guide.md)
- [Migrer le service personnel](docs/migration.md)
- [Preuves de validation et limites](docs/validation.md)
- [Contrats des fournisseurs](docs/provider-contracts.md)

Les pages de confidentialité et de conditions sont des documents de préparation
au lancement. Finaliser l’identité de l’éditeur et les informations légales avant
l’ouverture commerciale. Aucun compte distant ni abonnement n’est créé au lancement local.
