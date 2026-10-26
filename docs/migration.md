# Reprendre l’installation personnelle

Le service Node historique, ses scripts, son Dockerfile et la base personnelle
sont conservés. Le SaaS n’importe ni les secrets ni la base de l’ancien service.
Sa configuration est stockée par utilisateur dans une nouvelle base D1.

Pour passer à Accord sans recréer tous les événements :

1. Sauvegarder la base SQLite et noter les associations projet/calendrier.
2. Arrêter le service historique et désactiver l’intégration officielle sur les
   ressources concernées pour éviter deux moteurs concurrents.
3. Configurer le SaaS et connecter les mêmes comptes depuis le navigateur.
4. Créer une règle pour chaque association à reprendre.
5. Activer **Adopter mes événements existants** dans l’éditeur.
6. Prévisualiser avant activation. Les événements marqués `managedBy=t2gc` et
   `todoistId` sont retrouvés depuis Google, sans lire la base personnelle.
7. Vérifier les titres, horaires, commentaires et nouveaux changements des deux côtés.
8. Conserver la sauvegarde et l’ancien service arrêté jusqu’à validation.

La première reprise utilise la tâche Todoist comme référence pour remettre le
miroir en accord. Plusieurs événements anciens associés au même identifiant
bloquent la reprise au lieu d’en choisir un silencieusement. La procédure est
explicite ; aucune adoption ni écriture réelle n’a lieu en ouvrant la démo.

Une base D1 de production ne doit jamais être supprimée pour recommencer : elle
contient aussi les comptes et abonnements. Utiliser les sauvegardes et une
instance de test pour valider une restauration.
