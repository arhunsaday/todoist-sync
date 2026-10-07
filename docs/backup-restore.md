# Sauvegarde, restauration et reprise

## Preuve locale

```sh
pnpm backup:drill
```

L’exercice crée deux bases D1 locales temporaires, applique les migrations et
utilise uniquement des fixtures. Il exporte la première via Wrangler, compresse
et chiffre le SQL par AES-256-GCM, vérifie une mauvaise clé et une altération,
déchiffre puis importe le SQL dans la seconde base. Il compare toutes les lignes
des tables et vérifie intégrité SQLite, clés étrangères et déchiffrement d’un
jeton fournisseur. Le rapport est dans `docs/backup-validation.json`.

Node.js, pnpm et le CLI `sqlite3` sont nécessaires pour le contrôle local
d’intégrité. Aucune base existante n’est restaurée par cet exercice. Aucun accès Cloudflare
distant ni token réel n’est nécessaire. Les fichiers temporaires sont supprimés
après exécution ; les délais de restauration réseau ne sont pas mesurés.

## Politique opérateur proposée

- Export chiffré quotidien, conservation glissante 30 jours ; supprimer les exports
  plus anciens lors de la rotation. Le script ne programme pas ces opérations.
- Stocker les exports dans un coffre ou stockage privé hors machine de travail.
- Conserver la clé de sauvegarde **séparément** des archives ; conserver aussi
  BETTER_AUTH_SECRET et TOKEN_ENCRYPTION_KEY dans un coffre. D1 ne les contient pas.
- Vérifier une restauration isolée chaque mois et avant une migration importante.
- Objectifs à confirmer avec le plan choisi : RPO export 24 h ; RTO cible 1 h.
  Ce sont des objectifs d’exploitation, pas des délais démontrés en production.

D1 Time Travel est automatique : fenêtre actuelle 7 jours sur Free, 30 sur Paid.
Un export externe permet une récupération indépendante de cette fenêtre.
[Documentation Cloudflare](https://developers.cloudflare.com/d1/reference/time-travel/).

## Export chiffré d’une base réelle

Dans un terminal privé, définir `ACCORD_BACKUP_KEY` depuis votre coffre : une clé
base64 de 32 octets, distincte de la clé de chiffrement des tokens. Ne pas inscrire
la clé dans l’historique de commandes. Créer un dossier privé `backups/`.

```sh
node scripts/backup.mjs export --config=apps/worker/wrangler.production.json --database=accord-production --source=remote --output=backups/DATE.accord-backup
```

Le script affiche seulement une empreinte SHA256, ne remplace pas une archive
existante et supprime son SQL temporaire. L’export remote accède au compte Wrangler
connecté. Pour une base locale, utiliser `--source=local --state=/CHEMIN/EXPLICITE`
et la configuration de cette base. Le dossier temporaire et l’archive ont des
permissions privées ; le chiffrement protège l’archive stockée, pas un hôte compromis.

## Restauration de recette

```sh
node scripts/backup.mjs decrypt --input=backups/DATE.accord-backup --output=/DOSSIER-PRIVE/restore.sql
```

Importer dans une **nouvelle base isolée**, sans Worker ni connexion fournisseur
attachés : `wrangler d1 execute BASE-DE-RECETTE --remote --file=restore.sql` avec
une configuration pointant exclusivement sur la base de recette. Ne pas importer
l’export dans une base existante contenant des tables : ce n’est pas une fusion.

Vérifier schéma, comptages, liens, opérations, clients Stripe, chiffrés et
`PRAGMA foreign_key_check`. Vérifier les secrets internes avec une fixture, puis
le déchiffrement des valeurs restaurées dans un environnement privé. Supprimer
le SQL en clair après vérification. Ce scénario remote doit encore être testé
sur le compte du propriétaire.

## Incident en production

1. Arrêter les nouvelles requêtes de l’application et la consommation des travaux :
   utiliser une version de maintenance qui ne consomme ni Queues, ni Cron, ni
   alarmes Durable Objects. Débrancher les consommateurs et cron seul ne neutralise
   pas les alarmes déjà programmées. Vérifier l’absence d’écritures fournisseurs.
2. Noter versions Worker, Git, schéma, heure UTC, bookmark actuel et fenêtre impactée.
   Faire un export de l’état courant avant toute restauration.
3. Choisir et vérifier la sauvegarde sur la base isolée. Préparer une liste des
   suppressions de comptes, révocations et modifications intervenues après la
   sauvegarde ; elle doit être réappliquée avant reprise.
4. Une restauration Time Travel écrase D1 en place. La commande opérateur est
   `wrangler d1 time-travel restore BASE --bookmark=BOOKMARK` avec la configuration
   de production explicitement vérifiée. Conserver le bookmark permettant l’annulation.
   **Ne jamais exécuter cette commande comme simple test sur la production.**
5. Les tâches/événements externes, abonnements Stripe, messages Queues et états
   Durable Objects ne sont pas restaurés avec D1. Invalider les sessions restaurées,
   purger les tentatives OAuth/aperçus et désactiver les règles jusqu’à vérification.
   Ne pas remettre automatiquement des opérations historiques en pending.
6. Relire l’état actuel de Stripe, les autorisations fournisseurs et les miroirs.
   Réappliquer les suppressions intervenues depuis la sauvegarde pour ne pas réactiver
   des comptes effacés. Reprévisualiser les règles et arbitrer les divergences avant
   toute écriture. Les clés d’idempotence réduisent les doublons mais ne prouvent pas
   l’absence de divergence après un retour en arrière.
7. Réactiver un compte de test, puis les utilisateurs validés. Contrôler erreurs,
   opérations, facturation et notifications. Garder la sauvegarde d’avant restauration
   jusqu’à la fin de l’incident, avec une durée et un accès limités.

Un rollback du Worker vers une version compatible avec le schéma peut suffire ;
la restauration D1 est réservée aux incidents de données. Le dossier contient
une procédure de reprise, pas une simulation de Time Travel ou des Queues distantes.
