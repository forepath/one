# Webhook event naming

Every Forepath application (Agenstra, Decabill, …) publishes outbound webhooks through the shared notifications library (`libs/domains/shared/backend/feature-notifications`). Event types follow one naming convention so that the same concept has the same name in every application. That matters most for cross-application data syncs (for example tickets or users mirrored between Agenstra and Decabill).

Product catalogs: [Agenstra webhooks](../../agenstra/features/webhooks.md), [Decabill webhooks](../../decabill/features/webhooks.md).

## Convention

The convention follows the dot-delimited style used by Stripe and the [Standard Webhooks](https://www.standardwebhooks.com/) specification.

```text
<resource>.<action>
<resource>.<child>.<action>
```

| Part         | Rule                                                                                                                                                                                                                              | Examples                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Segments     | Lowercase `snake_case`, separated by dots. Two or three segments.                                                                                                                                                                 | `time_entry.created`                                                             |
| `<resource>` | Singular form of the matching PAT scope resource (`tickets:read` → `ticket.*`) or entity. It names the object in `data.object`.                                                                                                   | `ticket`, `customer_profile`, `agent`                                            |
| `<child>`    | Only for a dependent record with its own id that lives under `<resource>`. Modes, kinds and plugin keys are **never** a segment. They belong in the payload (`mode: "auto"`, `addonKey`, `ownerType`).                            | `ticket.comment.created`, `offer.line.fulfilled`                                 |
| `<action>`   | Past-tense verb (`created`, `updated`, `deleted`, `failed`) or the state reached (`available`, `exhausted`). Attribute or relationship changes use `<noun>_<verb>`. CRUD lifecycles always use `created` / `updated` / `deleted`. | `invoice.paid`, `meter_attached`, `level_changed`, `isolation.sandbox_available` |

The convention is enforced in code:

- `WEBHOOK_EVENT_TYPE_PATTERN` and `assertWebhookEventCatalog()` (`libs/domains/shared/backend/util-webhook`) validate every catalog. `NotificationsModule.register()` refuses to start with a malformed or duplicate event type.
- Each product catalog spec asserts the convention and that legacy names stay removed.

## Shared event groups

Concepts that exist in every product are defined once and spread into each product catalog:

| Group               | Constant                                                     | Events                                                                                                                                      |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity            | `IDENTITY_NOTIFICATION_EVENTS` (identity `util-auth`)        | `user.created`, `user.updated`, `user.deleted`                                                                                              |
| Application updates | `APPLICATION_NOTIFICATION_EVENTS` (shared `feature-updates`) | `application.update_available`, `application.update_check_failed`, `application.instance_outdated`, `application.dependency_health_changed` |
| Search index        | `SEARCH_NOTIFICATION_EVENTS` (shared `util-opensearch`)      | `search.reindex.started`, `search.reindex.completed`, `search.reindex.failed`, `search.document.sync_failed`                                |

## Cross-application events

These events carry the same name in Agenstra and Decabill:

| Event                            | Agenstra                                                 | Decabill                                |
| -------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| `user.*`                         | Instance users                                           | Tenant users                            |
| `ticket.created/updated/deleted` | Workspace tickets (`clientId`)                           | Project tickets (`projectId`)           |
| `ticket.comment.created`         | Comment author in `authorUserId`                         | Comment author in `userId`              |
| `attachment.created/deleted`     | Ticket, knowledge page or chat (`ownerType` / `ownerId`) | Project tickets (`ownerType: "ticket"`) |
| `application.*`, `search.*`      | Shared groups above                                      | Shared groups above                     |

Webhook-delivered events are thin where the source data is personal or secret: they carry identifiers and metadata. Consumers fetch details through the REST API with an app or PAT token that holds the matching `<resource>:read` scope.

## Renamed event types

The convention replaced the following names. Database migrations rewrite stored endpoint subscriptions and the delivery log, so existing endpoints keep receiving the events under their new names. Receivers that switch on the `type` field must accept the new names.

| Application | Previous name                               | Current name                                   | Reason                                                       |
| ----------- | ------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Agenstra    | `agent.chat.failed`                         | `agent.chat_failed`                            | `chat` is not a child record; matches `agent.session_failed` |
| Agenstra    | `agent.isolation_override`                  | `agent.isolation_overridden`                   | Action must be a past-tense verb                             |
| Agenstra    | `environment.created/updated/deleted`       | `environment_variable.created/updated/deleted` | "Environment" is the agent environment itself                |
| Decabill    | `payment.auto.initiated`                    | `payment.auto_initiated`                       | `auto` is a mode, not a child record                         |
| Decabill    | `payment.auto.retry_scheduled`              | `payment.auto_retry_scheduled`                 | Same as above                                                |
| Decabill    | `payment.auto.exhausted`                    | `payment.auto_exhausted`                       | Same as above                                                |
| Decabill    | `addon.container_manager.collection_failed` | `addon.collection_failed`                      | Addon key is in the payload (`addonKey`)                     |
| Decabill    | `ticket.attachment.created/deleted`         | `attachment.created/deleted`                   | Same name as Agenstra (`attachments:*` scope)                |

Migrations: `UnifyAgenstraWebhookEventNames1793800000000` and `UnifyBillingWebhookEventNames1793800000000`. Both are reversible.

## Adding an event

1. Pick the name from the convention above. Reuse the name another application already uses for the same concept.
2. Add it to the product catalog (`AGENSTRA_NOTIFICATION_EVENTS` / `BILLING_NOTIFICATION_EVENTS`), or to a shared group when every product emits it.
3. Build the payload from an explicit allowlist of fields. Never include secrets, credentials, message or page bodies, or personal data beyond identifiers.
4. If the payload contains user content or personal data, add the type to `WEBHOOK_SENSITIVE_EVENT_TYPES` so it cannot be delivered through `GET` query strings.
5. Pass the routing `clientId` (Agenstra workspace, Decabill customer user) so workspace- or customer-filtered endpoints receive it.
6. Document the event and its payload in the product webhook page.

Renaming an event needs a migration that rewrites `webhook_endpoints.subscribed_events` and `webhook_deliveries.event_type`. Subscriptions are validated against the catalog, so an unmigrated name blocks endpoint updates.
