# Dossier légal à compléter

Les pages `/legal`, `/privacy`, `/terms` contiennent une version préparatoire.
Les données publiques de l’éditeur sont centralisées dans
`packages/domain/src/legal.ts`. Aucune identité ni immatriculation n’a été inventée.

## Informations nécessaires

- Domaine, pays d’établissement et territoires de vente.
- Nom/raison sociale, statut, adresse, immatriculation, TVA lorsqu’applicables.
- Directeur de publication et email de support/droits.
- Public B2B, consommateurs ou les deux ; majorité et conditions d’accès retenues.
- Prix, devise, TTC/HT, régime TVA et facturation transfrontalière.
- Hébergeur : raison sociale, adresse et coordonnées vérifiées.
- Médiateur de la consommation effectivement désigné si vente B2C.
- Rétractation : fonctionnement du formulaire électronique applicable, démarrage
  anticipé, consentements, remboursements et confirmation sur support durable.
- Notice des garanties légales du service numérique applicable au marché ciblé.
- Durée et lieu d’archivage des factures selon les obligations du pays.
- Contrats Cloudflare/Stripe, rôle des sous-traitants, localisation D1 et garanties
  réelles de transfert hors EEE. La région D1 seule ne garantit pas une résidence
  européenne de tous les traitements.

Le fichier public n’accepte `approved: true` pour Checkout live que lorsque les
principaux champs sont renseignés. L’approbation doit aussi couvrir les éléments
ci-dessus : ce contrôle de présence ne vérifie pas leur exactitude juridique.

## Actions opérateur et preuves

- Conserver les versions acceptées des conditions et la preuve Stripe d’acceptation.
- Vérifier confirmation de commande et renouvellement, facture, portail et résiliation.
- Fournir aux consommateurs la fonction électronique de rétractation lorsqu’elle
  est requise. Le mail/formulaire modèle préparé ne suffit pas à lui seul pour
  attester la conformité du parcours applicable en 2026.
- Préparer le traitement manuel des demandes d’accès/export/effacement et remboursements.
  L’app propose la suppression du compte, pas un portail automatique pour tous les droits.
- Tenir un registre des traitements et des suppressions à réappliquer après restauration.
- Appliquer la purge des sauvegardes ; vérifier les durées des logs Cloudflare et Stripe.
- Fixer les responsabilités pour les ressources Notion professionnelles partagées ;
  un accord de traitement peut être nécessaire si Accord agit pour le compte d’un client.
- Valider les pages publiques avec les informations du propriétaire et les exigences
  des pays visés avant ouverture commerciale.

Sources consultées le 7 octobre 2026 :
[CNIL : information et droits](https://www.cnil.fr/fr/passer-laction/les-droits-des-personnes-sur-leurs-donnees),
[CNIL : conservation](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees),
[Service Public : commerce en ligne](https://entreprendre.service-public.gouv.fr/vosdroits/F23455),
[Service Public : rétractation](https://www.service-public.gouv.fr/particuliers/vosdroits/F10485),
[Google Limited Use](https://developers.google.com/terms/api-services-user-data-policy),
[Cloudflare Privacy](https://www.cloudflare.com/privacypolicy/).

Le cadre France/EEE sert de base à la préparation. Il ne remplace pas le choix
réel de juridiction ni les informations encore manquantes du propriétaire.
