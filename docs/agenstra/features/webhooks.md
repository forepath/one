# Webhooks (Agenstra)

Outbound webhook notifications let instance administrators register HTTPS endpoints that receive structured controller events.

## Access

- **Admin UI:** `/webhooks` in the agent console
- **REST API:** `/admin/webhooks` (admin role or API key)
- **Scope:** Endpoints are instance-wide (`scope_key = instance`). Optional `client_id` on an endpoint limits delivery to events for that workspace.

## Authentication modes

Same as Decabill: `none`, `authorization`, `custom_header`, or `query_param` (GET only). Deliveries include `Forepath-Signature` HMAC headers.

## Event naming

Event types follow one convention across all Forepath applications (Stripe / Standard Webhooks style, see [Webhook event naming](../../forepath/features/webhook-events.md)). The notification module checks it at startup:

- `<resource>.<action>`, for example `ticket.created`, `agent.deleted`
- `<resource>.<child>.<action>` only when `<child>` is a dependent record with its own id, for example `ticket.comment.created`, `search.document.sync_failed`
- Lowercase `snake_case` segments, two or three segments in total
- `<resource>` is the singular form of the matching PAT scope resource (`tickets:read` → `ticket.*`, `agents:read` → `agent.*`, `knowledge:read` → `knowledge_node.*`)
- `<action>` is a past-tense verb (`created`, `updated`, `deleted`, `failed`) or the resulting state (`available`). Attribute changes use `<noun>_<verb>` (`chat_failed`, `isolation_overridden`)
- Modes, kinds and plugin keys are never a segment. They are payload fields (`ownerType`, `level`, `mode`)
- The same concept uses the same event type in every application. Identity (`user.*`), application updates (`application.*`), search (`search.*`), tickets (`ticket.*`, `ticket.comment.created`) and attachments (`attachment.*`) are shared with Decabill.

### Renamed events

Migration `UnifyAgenstraWebhookEventNames1793800000000` rewrites stored endpoint subscriptions and the delivery log. Receivers that switch on `type` must accept the new names:

| Previous                                                            | Current                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `agent.chat.failed`                                                 | `agent.chat_failed`                                                                            |
| `agent.isolation_override`                                          | `agent.isolation_overridden`                                                                   |
| `environment.created`, `environment.updated`, `environment.deleted` | `environment_variable.created`, `environment_variable.updated`, `environment_variable.deleted` |

In Agenstra, "environment" means the agent environment itself. The old `environment.*` events described environment **variables**, so they were renamed.

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
- `attachment.created`, `attachment.deleted`: a file was attached to or removed from a ticket, knowledge page or chat (`ownerType` is `ticket`, `knowledge_page` or `chat`)
- `knowledge_node.created`, `knowledge_node.updated`, `knowledge_node.deleted`: a knowledge folder or page was created, changed (title, parent, order, content) or deleted. This includes external imports and duplicates. Page `content` is never included

**Subtasks:** Subtasks are tickets with a `parentId`. Adding a subtask publishes `ticket.created` (payload includes `parentId`). Removing a subtask publishes `ticket.deleted`. Reparenting publishes `ticket.updated` with the new `parentId`. The parent ticket does **not** receive a separate event when children change.

**Comments:** Adding a comment publishes `ticket.comment.created`. Comments cannot be updated or deleted via the API, so there are no update/delete comment events.

### Initiatives

Metadata only (ids, titles, statuses, versions; never document content). See [Initiatives](./initiatives.md).

- `initiative.created`, `initiative.updated` (`fields`), `initiative.deleted`
- `initiative.artifact.accepted`: a document version became the accepted contract
- `initiative.run.needs_input`, `initiative.run.ready`, `initiative.run.failed`: a guided step needs an answer, has a result to review, or failed
- `initiative.proposal.created`, `initiative.proposal.decided` (`status`)
- `initiative.work_items.transferred` (`ticketIds`), `initiative.work_items.released` (`keys`, `ticketIds`, `automatic`)
- `initiative.retrospective.completed` (`epicId`, `verdict`, `overridden`)

### Agents (environments)

- `agent.created`, `agent.updated`, `agent.deleted`: an agent environment was created, updated or deleted through the controller
- `agent.session_failed`: the agent runtime session failed
- `agent.permission_denied`: the agent was denied a permission
- `agent.chat_failed`: a chat turn failed (`CHAT_ERROR`)

Agent payloads never include the generated agent password, git remote URLs or chat contents.

### Chat, filters and egress

- `chat_message.created`, user or agent chat message in a workspace session (payload may include `chatId`)
- `chat_session.created`, `chat_session.updated`, `chat_session.deleted` — user-visible chat session lifecycle for an agent environment
- `message_filter.triggered`, a message filter dropped, rewrote or flagged a message (renamed from `filter_rule.triggered`)
- `agent_config.updated`, an agent configuration layer was saved (global, workspace or environment)
- `egress.blocked`, `egress.observed`, egress guard blocked a request or would have blocked it in `monitor` mode (summarized per ingestion run)
- `egress.guard_failed`, an egress guard sidecar reported an error
- `egress.policy_applied`, `egress.policy_failed`, an egress policy bundle was activated or rejected (last known good stays active)

### Container isolation

- `isolation.sandbox_available`, the sandboxed (gVisor) isolation level of a workspace host became ready
- `isolation.sandbox_unavailable`, the sandboxed level of a workspace host was ready and is not anymore (probe failed, runtime removed or disabled)
- `isolation.sandbox_kvm_available`, the sandboxed-kvm (gVisor on KVM) isolation level of a workspace host became ready
- `isolation.sandbox_kvm_unavailable`, the sandboxed-kvm level of a workspace host was ready and is not anymore (probe failed, KVM or runtime removed, or disabled)
- `isolation.microvm_available`, the microvm (KVM microVM) isolation level of a workspace host became ready
- `isolation.microvm_unavailable`, the microvm level of a workspace host was ready and is not anymore (probe failed, KVM or microVM image unavailable, or disabled)
- `isolation.baseline_failed`, the standard (`runc`) baseline of a workspace host failed; the host cannot run environments
- `agent.isolation_overridden`, an environment was created with a weaker isolation level than recommended (confirmed user choice)
- `agent.sandbox_creation_failed`, a sandboxed, sandboxed-kvm or microvm environment could not be started (never retried on a weaker runtime)

Host transitions are detected against the controller's last stored capability snapshot and published once per transition. See [Container Isolation Levels](./container-isolation.md).

### Agent environment variables

- `environment_variable.created`, `environment_variable.updated`, `environment_variable.deleted`

Environment payloads include variable **name** and metadata only; secret **values are never included**.

### Identity and workspace membership

- `user.created`, `user.updated`, `user.deleted`
- `client_user.created`, `client_user.deleted`

### Application updates

Webhook-only (no email). Emitted by the agent-controller update-check job and instance heartbeats:

- `application.update_available` — a newer GitHub release was detected versus the previously stored latest
- `application.update_check_failed` — GitHub Releases API unreachable or returned an error
- `application.instance_outdated` — after a successful check, an instance transitioned to `update_available`
- `application.dependency_health_changed` — Valkey, queue, or database health flipped for a tracked instance

See [Application updates](./application-updates.md).

### Search index

- `search.reindex.started`, `search.reindex.completed`, `search.reindex.failed`: the OpenSearch reindex coordinator ran (`failed` also fires per failed batch, with `entityType` and `offset`)
- `search.document.sync_failed`: a single document could not be written to or removed from the index (`entityType`, `id`, `action`, `error`, `failedAt`)

These events are instance-wide (no `client_id`).

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

### `agent.created` / `agent.updated` / `agent.deleted`

```json
{
  "id": "agent-uuid",
  "clientId": "client-uuid",
  "name": "build-agent",
  "description": "Builds the frontend",
  "agentType": "opencode",
  "isolationLevel": "sandboxed",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-01T10:00:00.000Z"
}
```

`agent.deleted` carries `id` and `clientId`. The other fields are `null`.

### `knowledge_node.created` / `knowledge_node.updated` / `knowledge_node.deleted`

```json
{
  "id": "node-uuid",
  "clientId": "client-uuid",
  "nodeType": "page",
  "title": "Deploy runbook",
  "parentId": "folder-uuid",
  "sortOrder": 2,
  "longSha": "4f1c...",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-02T10:00:00.000Z"
}
```

`nodeType` is `folder` or `page`. Fetch the page through the knowledge API (`knowledge:read`) when you need its content.

### `attachment.created` / `attachment.deleted`

```json
{
  "id": "attachment-uuid",
  "clientId": "client-uuid",
  "ownerType": "ticket",
  "ownerId": "ticket-uuid",
  "fileName": "trace.log",
  "contentType": "text/plain",
  "byteSize": 2048,
  "contentSha256": "9f86d0...",
  "createdByUserId": "user-uuid",
  "createdAt": "2026-07-01T10:00:00.000Z"
}
```

### `chat_message.created`

```json
{
  "agentId": "agent-uuid",
  "direction": "incoming",
  "source": "user",
  "message": "Hello agent",
  "userId": "user-uuid",
  "chatId": "chat-session-uuid"
}
```

`direction` is `incoming` or `outgoing`. `source` is `user` or `agent`. `chatId` is the user-visible chat session when the message is tied to one (may be null for some flows).

### `chat_session.created` / `chat_session.updated` / `chat_session.deleted`

```json
{
  "id": "chat-session-uuid",
  "agentId": "agent-uuid",
  "title": "Investigation",
  "kind": "user",
  "lastMessageAt": "2026-07-01T11:00:00.000Z",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "updatedAt": "2026-07-01T11:00:00.000Z"
}
```

`kind` is `primary` or `user`. Delete events always include `id` and `agentId`; other fields may be null when only identifiers are available.

### `message_filter.triggered`

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
  "userId": "user-uuid",
  "messagePreview": "..."
}
```

`status` is `dropped` or `filtered`; the rule name is in `filterDisplayName`.

### `agent_config.updated`

```json
{
  "layer": "workspace",
  "clientId": "client-uuid",
  "agentId": null,
  "changedRoots": ["egress", "message_filters"],
  "securityRootsChanged": ["egress", "message_filters"],
  "locksChanged": false,
  "secretKeysChanged": [],
  "updatedByUserId": "user-uuid"
}
```

Values are never included, only the changed root keys. Global-layer saves carry no `clientId` and are delivered instance-wide.

### `egress.blocked` / `egress.observed`

```json
{
  "agentId": "agent-uuid",
  "kind": "web",
  "decision": "blocked",
  "host": "example.org",
  "rule": "not_allowlisted",
  "matchedEntry": null,
  "matchedSource": null,
  "method": "CONNECT",
  "count": 4,
  "firstSeenAt": "2026-07-01T10:00:00.000Z",
  "lastSeenAt": "2026-07-01T10:00:12.000Z",
  "omittedDecisions": 0
}
```

`egress.observed` has the same shape and is emitted in `monitor` mode. See [Egress Filtering](./egress-filtering.md).

### `egress.guard_failed` / `egress.policy_applied` / `egress.policy_failed`

```json
{ "agentId": "agent-uuid", "message": "Egress guard error", "occurredAt": "2026-07-01T10:00:00.000Z" }
```

`egress.guard_failed` uses the payload above. `egress.policy_applied` and `egress.policy_failed` carry `{ "agentId", "mode", "revision", "error" }`.

### `isolation.sandbox_available` / `isolation.sandbox_unavailable` / `isolation.sandbox_kvm_available` / `isolation.sandbox_kvm_unavailable` / `isolation.microvm_available` / `isolation.microvm_unavailable` / `isolation.baseline_failed`

```json
{
  "clientId": "client-uuid",
  "clientName": "Production workspace",
  "level": "sandboxed",
  "runtime": "runsc-systrap",
  "previousState": "ready",
  "state": "probe-failed",
  "reasonCode": "E_SHARED_NETNS_FAILED",
  "recommendedLevel": "standard",
  "revision": "sha256:4f1c...",
  "probedAt": "2026-10-15T09:00:00.000Z"
}
```

`level` is `sandboxed` (`runtime` `runsc-systrap`) for `isolation.sandbox_available` / `_unavailable`, `sandboxed-kvm` (`runtime` `runsc-kvm`) for `isolation.sandbox_kvm_available` / `_unavailable`, `microvm` (`runtime` `runc`, the launcher container) for `isolation.microvm_available` / `_unavailable` and `standard` for `isolation.baseline_failed` (then `recommendedLevel` is `null`). `previousState` is `null` for the first observation of a workspace host. `reasonCode` is `null` when the level is `ready`.

### `agent.isolation_overridden`

```json
{
  "agentId": "agent-uuid",
  "agentName": "build-agent",
  "automaticSelection": "sandboxed",
  "effectiveSelection": "standard",
  "selectedBy": "user-uuid",
  "capabilityRevision": "sha256:4f1c..."
}
```

### `agent.sandbox_creation_failed`

```json
{
  "agentName": "build-agent",
  "isolationLevel": "sandboxed",
  "runtime": "runsc-systrap",
  "error": "The sandboxed (gVisor) container could not be started: ...",
  "occurredAt": "2026-10-15T09:12:00.000Z"
}
```

For a sandboxed-kvm environment `isolationLevel` is `sandboxed-kvm`, `runtime` is `runsc-kvm` and `error` starts with `The sandboxed-kvm (gVisor on KVM) container could not be started: ...`. For a microvm environment `isolationLevel` is `microvm`, `runtime` is `runc` and `error` starts with `The microvm (KVM microVM) container could not be started: ...`. No `agentId` is included because the environment was not created. `error` is truncated to 500 characters.

### `environment_variable.created` / `environment_variable.updated` / `environment_variable.deleted`

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

## GET endpoints

Endpoints that use `GET` receive the event as query parameters. They cannot subscribe to events that carry user content or personal data: chat, filter, egress decision, user, membership, ticket, comment, agent and knowledge node events.

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
