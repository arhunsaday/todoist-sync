# Contrats des fournisseurs

## Todoist

API v1 : `https://api.todoist.com/api/v1`. Lecture et commandes par POST `/sync`.
Les UUID de commandes sont déterministes pour une opération, et changent pour
une nouvelle révision. `sync_status` est contrôlé même lorsque HTTP vaut 200.
Les champs de récurrence `string`, `lang` et `is_recurring` sont conservés lors
du déplacement de l’occurrence. Aucun `item_delete` n’est émis.

Référence : [API Todoist](https://developer.todoist.com/api/v1/).

## Google Agenda

Calendar API v3, pages `nextPageToken` puis `nextSyncToken`. Un 410 du flux
réinitialise la lecture en conservant les liens. Dates de fin exclusives pour
les événements de journée entière. Instants UTC pour calculer les durées réelles
aux changements d’heure ; fuseau IANA pour l’affichage. Les événements portent
les références privées Accord et une empreinte de leur titre rendu.

Références : [synchronisation incrémentale](https://developers.google.com/workspace/calendar/api/guides/sync),
[events](https://developers.google.com/calendar/api/v3/reference/events).

## Notion

Header `Notion-Version: 2025-09-03`. Recherche et interrogation de data sources,
lecture/mise à jour/création de pages. Écritures limitées aux propriétés mappées ;
les blocs sont conservés. Validation du schéma lors des lectures d’exécution.
Aucun curseur global équivalent à celui de Todoist n’est supposé.

Notion n’offre pas ici une création universellement exactement-une-fois. Accord
utilise une propriété texte stable, recherche le miroir avant de créer et bloque
une création ambiguë plutôt que de la retenter aveuglément.

Références : [data sources](https://developers.notion.com/reference/query-a-data-source),
[autorisation](https://developers.notion.com/guides/get-started/authorization),
[webhooks](https://developers.notion.com/reference/webhooks).

## Stripe et Cloudflare

Stripe Checkout et Customer Portal. Événements signés sur corps brut, horodatage
contrôlé, traitement durable et relecture de l’abonnement actuel. La file
Cloudflare peut livrer plusieurs fois : les reçus, versions et opérations sont
persistés ; le coordinateur utilisateur sérialise les écritures.

Références : [Stripe subscriptions](https://docs.stripe.com/billing/subscriptions/webhooks),
[Queues delivery](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).
