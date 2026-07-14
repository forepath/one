# Webhooks (Agenstra)

Outbound webhook notifications let instance administrators register HTTPS endpoints that receive structured controller events.

## Access

- **Admin UI:** `/webhooks` in the agent console
- **REST API:** `/admin/webhooks` (admin role or API key)
- **Scope:** Endpoints are instance-wide (`scope_key = instance`). Optional `client_id` on an endpoint limits delivery to events for that workspace.

## Authentication modes

Same as Decabill: `none`, `authorization`, `custom_header`, or `query_param` (GET only). Deliveries include `Forepath-Signature` HMAC headers.

## Event envelope

```json
{
  "id": "uuid",
  "object": "event",
  "type": "ticket.created",
  "application": "agenstra",
  "tenant_id": null,
  "client_id": "workspace-uuid",
  "data": { "object": {} }
}
```

## Event catalog

Events are published from the **agent-controller** service after proxied operations complete or when realtime chat traffic is observed.

### Workspace and tickets

- `client.created`, `client.updated`, `client.deleted`
- `ticket.created`, `ticket.updated`, `ticket.deleted`
- `ticket.comment.created`

**Subtasks:** Subtasks are tickets with a `parentId`. Adding a subtask publishes `ticket.created` (payload includes `parentId`). Removing a subtask publishes `ticket.deleted`. Reparenting publishes `ticket.updated` with the new `parentId`. The parent ticket does **not** receive a separate event when children change.

**Comments:** Adding a comment publishes `ticket.comment.created`. Comments cannot be updated or deleted via the API, so there are no update/delete comment events.

### Chat and filter rules

- `chat_message.created` — user or agent chat message in a workspace session
- `filter_rule.created`, `filter_rule.updated`, `filter_rule.deleted`
- `filter_rule.triggered` — a filter rule dropped or flagged a message

### Agent environment variables

- `environment.created`, `environment.updated`, `environment.deleted`

Environment payloads include variable **name** and metadata only; secret **values are never included**.

### Identity and workspace membership

- `user.created`, `user.updated`, `user.deleted`
- `client_user.created`, `client_user.deleted`

## Payload examples

### `ticket.comment.created`

```json
{
  "id": "comment-uuid",
  "ticketId": "ticket-uuid",
  "authorUserId": "user-uuid",
  "body": "Looks good",
  "createdAt": "2026-07-01T11:00:00.000Z"
}
```

Author email is never included. Ticket body `content` is never included on ticket lifecycle events.

### `chat_message.created`

```json
{
  "agentId": "agent-uuid",
  "direction": "incoming",
  "source": "user",
  "message": "Hello agent",
  "userId": "user-uuid"
}
```

`direction` is `incoming` or `outgoing`. `source` is `user` or `agent`.

### `filter_rule.triggered`

```json
{
  "agentId": "agent-uuid",
  "direction": "incoming",
  "status": "dropped",
  "filterType": "regex",
  "filterDisplayName": "Secrets",
  "reason": "Matched secret pattern",
  "wordCount": 3,
  "charCount": 11,
  "userId": "user-uuid"
}
```

`status` is `dropped` or `filtered`.

### `environment.created` / `environment.updated` / `environment.deleted`

```json
{
  "id": "env-var-uuid",
  "agentId": "agent-uuid",
  "variable": "API_KEY",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-02T10:00:00.000Z"
}
```

Delete events may omit `variable` and timestamps when only identifiers are available.

## Delivery and retries

Deliveries are queued on the `agent-controller` BullMQ queue. Each delivery is retried up to **3 times** with exponential backoff (starting at 5 seconds). Every attempt is logged in the delivery history with its attempt number. The endpoint `consecutive_failures` counter increments only after all retries for an event are exhausted. Endpoints auto-disable after **10** consecutive failed events.

## Delivery log retention

Each webhook endpoint maintains its own delivery log. Retention is enforced **per endpoint** in two phases:

1. **Age-based:** Delete delivery rows older than the configured retention window.
2. **Count-based:** If the endpoint still has more rows than the configured maximum, delete the oldest excess entries (newest entries are kept).

| Setting          | Endpoint field             | Platform default                                |
| ---------------- | -------------------------- | ----------------------------------------------- |
| Retention window | `deliveryLogRetentionDays` | `WEBHOOK_DELIVERY_LOG_RETENTION_DAYS` (30 days) |
| Max entries      | `deliveryLogMaxEntries`    | `WEBHOOK_DELIVERY_LOG_MAX_ENTRIES` (500)        |

Set either field to `null` on update to revert to platform defaults. Omit both on create to use defaults immediately.

Pruning runs after each delivery, when retention settings change, and on the hourly `webhook-delivery-retention.coordinator` background job (`WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS`).

## Endpoint deletion

Deleting a webhook endpoint removes all associated delivery logs immediately (application-level cleanup plus database `ON DELETE CASCADE`). In-flight delivery jobs that finish after deletion skip persisting a delivery log rather than creating orphaned rows.
