# Vos premiers accords

1. Connectez-vous avec Google.
2. Dans **Connexions**, autorisez les outils dont vous avez besoin.
3. Ouvrez **Mes règles**, puis **Créer une règle**.
4. Choisissez un projet, une source de données ou un calendrier de chaque côté.
5. Choisissez les champs, filtres et comportements.
6. Enregistrez, puis prévisualisez la règle.
7. Vérifiez les opérations et activez la synchronisation.

La connexion Google au produit n’autorise pas automatiquement l’accès au
calendrier. Celui-ci se connecte séparément dans Connexions.

## Choisir une direction

En direction unique, la source pilote les champs sélectionnés. En direction
bidirectionnelle, des nouveaux éléments et changements peuvent venir des deux
côtés. Les calendriers ne peuvent pas recevoir les tâches sans date. Plusieurs
règles peuvent former une chaîne, mais les boucles sont refusées. Pour relier
plusieurs destinations du même outil à une ressource, utiliser une direction
unique afin d’éviter une attribution ambiguë des nouveaux éléments.

## Filtres et titres

Une tâche doit satisfaire tous les filtres actifs : une des sections choisies,
une des priorités et toutes les étiquettes sélectionnées. Une sélection vide
n’ajoute pas de restriction. Les préfixes d’étiquettes servent uniquement au
titre affiché dans l’agenda. Les liens du titre Todoist sont préservés lors d’un
simple changement d’horaire dans Google.

Les commentaires Todoist se copient vers Google ; ils ne remontent pas depuis
Google. Les propriétés Notion sont associées par identifiant : renommer une
colonne garde l’association. Supprimer une colonne bloque la règle et demande
une correction du mapping, sans vider les champs des autres outils.

## Récurrences et suppressions

Todoist pilote la règle de récurrence. Accord représente l’occurrence actuelle
par un événement simple. Déplacer ce créneau conserve la règle Todoist ; terminer
l’occurrence permet à Todoist de fournir la suivante. Les séries récurrentes
Google étrangères ne sont pas transformées en tâches.

Supprimer un événement dissocie les éléments par défaut. L’option « Terminer la
tâche liée » change explicitement ce comportement. Accord ne supprime jamais
une tâche Todoist définitivement. Pour une tâche terminée, vous pouvez conserver
un événement marqué ou retirer le miroir. Une tâche rouverte ou redatée peut
retrouver son miroir après un retrait décidé par la règle.

## Activité et conflits

Les champs modifiés indépendamment peuvent être fusionnés. En cas de conflit
sur le même champ, **Activité** propose de comparer les deux versions et de
choisir celle à conserver. Si elles ont changé pendant votre lecture, rechargez
les versions. Les autres paires continuent leur synchronisation.

La pause, la déconnexion et la fin d’essai arrêtent les écritures. Les éléments
déjà présents dans les outils restent en place. Une erreur temporaire est
retentée automatiquement ; une erreur durable apparaît dans Activité.

Les notifications accélèrent les changements ; la réconciliation périodique
rattrape les notifications manquées. Il n’y a pas de délai « instantané » garanti.
