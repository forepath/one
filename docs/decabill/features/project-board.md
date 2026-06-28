# Project Board

Live Kanban-style board for project tickets with Socket.IO updates on the **`projects`** namespace.

## Overview

The project board displays hierarchical tickets in swimlanes by status. Admins create, edit, drag between lanes, and lock tickets. Customers view the board read-only and may add comments on tickets. REST mutations emit realtime events to clients joined to the project room.

Specification: [Billing Manager AsyncAPI](/spec/billing-manager/asyncapi.yaml) (`projects` server).

## Swimlanes

The UI renders four active lanes plus terminal states:

| Lane (board)  | Ticket status    | Who can move                               |
| ------------- | ---------------- | ------------------------------------------ |
| Draft         | `draft`          | Admin only                                 |
| To do         | `todo`           | Admin only                                 |
| In progress   | `in_progress`    | Admin only                                 |
| Prototype     | `prototype`      | Admin only                                 |
| Done / Closed | `done`, `closed` | Admin only (detail editor, not drag lanes) |

Lane labels are localized in the billing console. Locked tickets cannot be edited or dragged by admins. See [Locking](#locking).

Customers never see create-ticket or drag-drop controls (`isAdmin=false` on the board component).

## Locking

Locking freezes **delivery scope** on the board — what was agreed and documented — separately from **billing**, which freezes **hours and money**.

### Why lock

Typical reasons to lock work:

- **Sign-off** — Ticket is done and you do not want title, description, or acceptance criteria changed after the customer saw it.
- **Audit trail** — Each ticket has a stable content SHA; lock marks that version as final and records a `LOCKED` activity entry.
- **Accident prevention** — Stop later edits to closed work while the project stays active.

Locking is **not** a prerequisite for bill-time and does **not** run automatically when you invoice hours.

### Ticket lock

Admins lock a ticket from the ticket detail modal (lock icon) or via `POST /tickets/{ticketId}` with `{ "locked": true }`. Lock is **one-way** — there is no unlock in the API or UI.

When `locked` is true:

| Blocked                                                         | Still allowed                            |
| --------------------------------------------------------------- | ---------------------------------------- |
| Title, description, status, priority, milestone, parent updates | Read (admin and customer)                |
| Drag between swimlanes                                          | View existing comments                   |
| Delete                                                          | View existing time entries on the ticket |
| New comments                                                    |                                          |
| New time entries linked to the ticket                           |                                          |

The backend rejects update and delete with `400 Cannot update locked ticket` / `Cannot delete locked ticket`. A successful lock emits `ticketUpsert`, `ticketActivityCreated` (`LOCKED`), and `projectSummaryChanged`.

### Milestone lock

Admins lock a milestone from the milestones panel or via `POST /milestones/{id}/lock`. Lock is **one-way**.

When `lockedAt` is set:

| Blocked                                  | Still allowed                                                         |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Milestone rename and other field updates | Read milestones and tickets                                           |
| Milestone delete                         | Ticket and time-entry operations (unless the ticket itself is locked) |

Milestone lock marks a **delivery phase** as closed. Ticket lock is **per item** within a phase.

### Relationship to billing

These mechanisms are related in workflow but **not connected in code** today:

| Mechanism      | What it freezes                                                  |
| -------------- | ---------------------------------------------------------------- |
| Ticket lock    | Ticket scope and board position                                  |
| Milestone lock | Milestone metadata                                               |
| Bill time      | Unbilled time entries → issued invoice (`billedAt`, `invoiceId`) |

`POST /admin/billing/projects/{projectId}/bill-time` bills unbilled time entries **within the requested datetime range** regardless of ticket or milestone lock. The billing console loads default **From**/**To** values from `GET .../unbilled-time-bounds` before submit. After bill-time, billed time entries are immutable — that is the **billing freeze**, not ticket lock.

See [Projects — Bill Time](./projects.md#bill-time) for invoicing preconditions and results.

### Enforcement status

- **Ticket lock:** Enforced on the backend and in the billing console UI.
- **Milestone lock on tickets:** Ticket mutations when the assigned milestone is locked are **not yet enforced** on the backend (helper exists; wiring is pending). Milestone lock currently applies to the milestone row only.

## REST Board Operations

Base path: `/projects/{projectId}`

### Tickets

| Method | Path                           | Access                                                            |
| ------ | ------------------------------ | ----------------------------------------------------------------- |
| GET    | `/tickets`                     | Customer read, admin read (optional `status`, `parentId` filters) |
| GET    | `/tickets/{ticketId}`          | Customer read, admin read                                         |
| GET    | `/tickets/{ticketId}/comments` | Customer read, admin read                                         |
| GET    | `/tickets/{ticketId}/activity` | Customer read, admin read                                         |
| POST   | `/tickets`                     | Admin only                                                        |
| POST   | `/tickets/{ticketId}`          | Admin only                                                        |
| DELETE | `/tickets/{ticketId}`          | Admin only                                                        |
| POST   | `/tickets/{ticketId}/comments` | Customer or admin                                                 |

Tickets support parent-child hierarchy and optional milestone assignment. Each ticket gets a stable content SHA for traceability. Time entries may reference a ticket (`ticketId` filter on `GET /time-entries`); the ticket detail panel lists linked entries and admins can log time from there. Ticket-scoped time entry changes emit `timeEntryUpsert` / `timeEntryRemoved` on the project board WebSocket.

### Milestones

| Method | Path                    | Access                                                                                         |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/milestones`           | Customer read, admin read                                                                      |
| POST   | `/milestones`           | Admin only                                                                                     |
| POST   | `/milestones/{id}`      | Admin only                                                                                     |
| POST   | `/milestones/{id}/lock` | Admin only (one-way milestone lock; see [Project Board — Locking](./project-board.md#locking)) |
| DELETE | `/milestones/{id}`      | Admin only                                                                                     |

## WebSocket Connection

### URL and Namespace

Configure the billing console runtime config:

```json
{
  "billing": {
    "websocketUrl": "ws://localhost:8082/billing",
    "projectsWebsocketUrl": "ws://localhost:8082/projects",
    "tenantId": "default"
  }
}
```

When `projectsWebsocketUrl` is omitted, the client derives it from `websocketUrl` by replacing the `/billing` path segment with `/projects`.

Backend environment variables:

| Variable                       | Default    | Purpose                                            |
| ------------------------------ | ---------- | -------------------------------------------------- |
| `WEBSOCKET_PORT`               | `8082`     | Socket.IO TCP port (shared with dashboard gateway) |
| `PROJECTS_WEBSOCKET_NAMESPACE` | `projects` | Namespace path segment                             |
| `WEBSOCKET_CORS_ORIGIN`        | `*`        | CORS origin for browser clients                    |

### Authentication

Pass the same credentials as HTTP in the Socket.IO handshake:

- **Keycloak:** `Bearer <keycloak-jwt>` in `auth.Authorization` or handshake headers
- **Users:** `Bearer <jwt>` in `auth.Authorization` or handshake headers
- **API key:** **Not supported**. `setProject` emits `error` with message "User not authenticated"

Pass tenant in the handshake:

- **Browser clients:** `auth.tenantId` and `auth.Authorization`
- **Node clients:** `extraHeaders: { 'X-Tenant': 'default', Authorization: '...' }`

The authenticated user's `tenant_id` must match the socket tenant.

## Events

### Client to Server

| Event        | Payload               | Purpose                                            |
| ------------ | --------------------- | -------------------------------------------------- |
| `setProject` | `{ projectId: uuid }` | Join `project:{projectId}` room after access check |

On success the server emits `setProjectSuccess`. On failure it emits `error` to the initiating socket only.

### Server to Client

Events are broadcast to the project room (`project:{projectId}`) after successful REST mutations:

| Event                   | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `ticketUpsert`          | Created or updated ticket (full DTO)                               |
| `ticketRemoved`         | `{ id, projectId }`                                                |
| `ticketCommentCreated`  | New comment on a ticket                                            |
| `ticketActivityCreated` | Audit activity entry                                               |
| `milestoneUpsert`       | Created or updated milestone                                       |
| `milestoneRemoved`      | `{ id, projectId }`                                                |
| `timeEntryUpsert`       | Created or updated time entry                                      |
| `timeEntryRemoved`      | `{ id, projectId }`                                                |
| `projectSummaryChanged` | Updated KPI summary (tickets, milestones, time entries, bill-time) |
| `error`                 | Application errors for the initiating socket                       |

## Security Model

- Clients must call `setProject` before receiving room broadcasts
- The server validates project readability (admin or assigned customer) before joining a room
- Room membership is per socket; disconnect leaves the previous project room
- API key auth cannot join project rooms
- REST ownership checks mirror WebSocket access (`ensureProjectReadable`)

Unlike the dashboard status gateway, the project board **uses Socket.IO rooms** scoped by project id.

## Connection Flow

```mermaid
sequenceDiagram
    participant UI as Billing Console
    participant GW as Project Board Gateway
    participant DB as PostgreSQL

    UI->>GW: Connect (Bearer JWT, tenantId)
    GW->>GW: Validate auth and tenant
    UI->>GW: setProject { projectId }
    GW->>DB: Load project + user tenant
    GW->>GW: ensureProjectReadable
    GW->>GW: socket.join(project:projectId)
    GW-->>UI: setProjectSuccess
    Note over UI,GW: REST mutation elsewhere
    GW-->>UI: ticketUpsert (room broadcast)
```

Sequence source: [`project-board-realtime.mmd`](../../../libs/domains/decabill/backend/feature-billing-manager/docs/project-board-realtime.mmd)

## Frontend Integration

NgRx effects in `data-access-billing-console`:

- `connectProjectBoardSocket$` — connect when entering a project board
- `setProjectBoardSocketProjectEmit$` — emit `setProject` after connect
- `restoreProjectBoardSocketProject$` — re-emit `setProject` after reconnect
- Socket events dispatch board slice updates (tickets, milestones, time entries, summary)

The `ProjectBoardComponent` loads tickets over REST on init, connects the socket, and calls `setProject(projectId)`.

## Related Documentation

- **[Projects](./projects.md)** - Assignment, admin CRUD, bill-time, KPIs
- **[Real-time Status](./real-time-status.md)** - Separate `billing` namespace for server status
- **[Authentication](./authentication.md)** - JWT and Keycloak handshake
- **[Multi-tenancy](./multi-tenancy.md)** - Tenant in handshake
- **[Billing Manager AsyncAPI](/spec/billing-manager/asyncapi.yaml)** - Full message schemas

---

_Static API key auth cannot subscribe to project board updates; use interactive auth in the billing console._
