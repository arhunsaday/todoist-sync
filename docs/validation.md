# Validation locale

Vérifications réalisées sur le worktree `codex/accord-product` le 6 octobre 2026.

| Vérification                                                                               | Résultat                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Service historique : `pnpm test`                                                           | 208 tests réussis                            |
| Domaine et adaptateurs : `pnpm test:saas`                                                  | 26 tests réussis                             |
| Workers/D1/Durable Objects : `pnpm test:worker`                                            | 17 tests réussis                             |
| Navigateurs : `pnpm test:browser`                                                          | 4 tests réussis, desktop et mobile           |
| TypeScript historique et SaaS                                                              | Vérifications réussies                       |
| Builds historique et SaaS                                                                  | Réussis                                      |
| Migrations D1 locales                                                                      | Appliquées avec succès sur stockage isolé    |
| Navigation landing, démo, règles, connexions, activité, facturation, paramètres, connexion | Aucune erreur JavaScript ou console observée |
| Captures desktop                                                                           | Landing et tableau de bord inspectés         |

## Ce qui est couvert

- Sessions réelles Better Auth/D1 et refus des données d’un autre utilisateur.
- Création d’une règle via API, version optimiste, aperçu sans écriture,
  activation, traitement coordonné et modification du miroir via clients HTTP.
- Réponse perdue après création : reprise du miroir sans doublon et sans écraser
  une modification plus récente.
- Opérations distinctes pour les éditions répétées A → B → A → B.
- Refus de réactivation d’une règle créant un triangle.
- Perte d’accès à une page Notion et suppression d’une propriété mappée,
  y compris lors de la récupération d’un miroir après panne.
- Conservation de la récurrence Todoist lors du déplacement de l’occurrence.
- Recréation après réouverture/redatation d’une tâche dont Accord a retiré le miroir,
  avec conservation de la dissociation pour une suppression manuelle.
- Arrêt des écritures après fin d’essai, déconnexion et pause.
- Chiffrement lié à l’utilisateur/connexion et vérification des signatures Stripe,
  dont les notifications hors délai de tolérance.
- Pagination Google, expiration des curseurs et erreurs Todoist sous HTTP 200.
- Création/édition de règle dans la démonstration sur ordinateur et mobile.

## Revue indépendante

Une revue par un autre agent a identifié sept problèmes de synchronisation.
Des tests ont d’abord reproduit les comportements, puis les corrections ont été
vérifiées. Les erreurs initiales de types Hono ont disparu après l’installation
isolée avec la version pnpm fixée ; aucun fichier métier legacy n’a été modifié.

## Ce qui reste externe

Aucun compte fournisseur réel, identifiant OAuth, clé Stripe réelle, domaine ou
ressource Cloudflare distante n’a été utilisé. Les réponses fournisseurs sont
simulées dans les tests. Le code n’est pas une preuve de consentement OAuth,
d’acceptation de scopes, de paiement bancaire réel ou de délai de notification
chez les fournisseurs.

Avant ouverture : configurer les applications OAuth, Cloudflare et Stripe test,
valider les trois paires avec comptes dédiés, puis le cycle Stripe
souscription/renouvellement/échec/résiliation. Tester aussi les webhooks Notion et
Google sur HTTPS, la sauvegarde/restauration D1 et le rollback Worker. Finaliser
les pages légales. Ne pas ouvrir les paiements réels avant cette validation.

## Limites explicites de V1

- Un compte par fournisseur et utilisateur ; les cycles de règles sont refusés.
- Récurrences Todoist : occurrence actuelle uniquement ; séries Google étrangères exclues.
- Création Notion exige une propriété Accord ID ; les créations ambiguës demandent
  une vérification et ne sont pas retentées aveuglément.
- Pas de délai temps réel garanti, d’auto-planification ou de récurrence Notion implicite.
- Le déplacement entre différentes sources de données Notion n’est pas une
  migration automatique de pages. Reconfigurer la règle et prévisualiser la cible.
- L’aperçu présente au maximum 200 décisions ; son compteur indique le lot total.
  Les lots dépassant le seuil exigent une confirmation explicite.

Le SDK Stripe émet des avertissements de sourcemaps manquantes pendant les tests
Workers. Le build contient aussi un avertissement d’annotation du paquet Zod.
Ce sont des avertissements des dépendances ; les commandes terminent avec succès.
