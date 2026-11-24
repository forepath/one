# Action Center

The to-do list of the agent console for admins and managers: every open next step across the workspaces (approvals agents are waiting for, failed automation, broken integrations, setup to finish), collected automatically and updated live.

## Overview

A light bulb in the top bar (`bi-lightbulb`) shows the number of open to-dos as a badge. It opens the action center, a sidebar on the right below the top bar:

- **Docked** next to the content from 1200 px width, **overlaid** on narrower screens. It never covers the top bar, and it is never wider than the content area (the navigation rail stays visible). The open state is remembered per browser.
- **Suggested next steps** (highlighted) on top, e.g. connecting the first workspace or setting up email.
- **To-dos per area** below (Workspaces, Tickets, Agent automation, Deployments, Integrations, Platform). Each type is one card; several records of the same type are shown as a **stack of cards** with their number, **Show all** expands it (up to 25 records).
- A to-do leads to its page in the right workspace (e.g. `/tickets/<workspace>?openTicketId=<ticket>` opens the ticket). Choosing a to-do switches the console into the mode of the target page, so admins and managers can use the action center in user mode too.
- The list updates live without reloading. The bulb (or Escape) closes the panel again; on phones it also closes after choosing a to-do.

The bulb and the sidebar are shown to admins and managers in both console modes, never to regular users.

## To-dos

| Area             | Type                                    | Condition                                                                                                      | Who    |
| ---------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| Setup            | `agenstra.setup.first_workspace`        | No workspace is registered                                                                                     | all    |
| Setup            | `platform.setup.email`                  | `SMTP_HOST` empty: no emails are sent                                                                          | admins |
| Workspaces       | `agenstra.workspaces.isolation_failed`  | The standard container isolation of a workspace host is `unsupported`, `installation-failed` or `probe-failed` | all    |
| Workspaces       | `agenstra.agents.config_sync_failed`    | OpenCode configuration or layer files failed to sync to an agent                                               | all    |
| Workspaces       | `agenstra.workspaces.graph_failed`      | The latest workspace graph build failed                                                                        | all    |
| Tickets          | `agenstra.tickets.automation_approval`  | Open tickets eligible for autonomous work that require approval                                                | all    |
| Tickets          | `agenstra.tickets.automation_attention` | The latest autonomous run (last 14 days) of an open ticket failed, timed out or escalated                      | all    |
| Agent automation | `agenstra.tasks.approval_pending`       | Scheduled tasks created / changed by agents that wait for approval                                             | all    |
| Agent automation | `agenstra.tasks.run_failed`             | Enabled, approved tasks whose last run failed                                                                  | all    |
| Agent automation | `agenstra.handoffs.failed`              | Handoffs of the last 14 days that failed or whose answer could not be delivered                                | all    |
| Deployments      | `agenstra.deployments.approval_pending` | Deployment workflows waiting for approval                                                                      | all    |
| Deployments      | `agenstra.deployments.run_failed`       | Enabled workflows whose last run (last 14 days) failed or timed out                                            | all    |
| Integrations     | `agenstra.connections.test_failed`      | Deployment or Atlassian connections whose last test failed                                                     | all    |
| Integrations     | `agenstra.imports.failed`               | Enabled Jira / Confluence imports reporting an error                                                           | all    |
| Platform         | `platform.updates.available`            | A newer release or outdated instances (see [Application Updates](./application-updates.md))                    | all    |
| Platform         | `platform.webhooks.failing`             | Webhook endpoints with consecutive failures or disabled after them                                             | all    |
| Platform         | `platform.email.delivery_failed`        | Emails of the last 7 days that finally failed                                                                  | all    |

"Who": **all** = admins and managers; **admins** = only admins, because the fix lives on the admin-only system settings page.

## Silencing

The bell menu of a card or record silences it:

- **Silence for me**, **Snooze for 1 day**, **Snooze for 1 week**: only for the current user (admins and managers).
- **Silence for everyone**: hides it for every admin and manager (admins only).

A silence covers either a whole type or one record. Silenced to-dos do not count in the badge. The **Silenced** tab lists the silences that apply to you; you can lift your own, admins also the ones for everyone. Limits: 300 personal silences per user and 2,000 silences for everyone.

## Live updates

The console holds one Socket.IO connection to `socket/action-center` (`ACTION_CENTER_WEBSOCKET_NAMESPACE`) while an admin or manager is signed in. The controller recomputes the to-dos and pushes a view to each connected viewer, only when that viewer's view changed:

- right after every successful mutating REST request, debounced by `ACTION_CENTER_RECOMPUTE_DEBOUNCE_MS` (default 400 ms)
- right after published webhook events that can change to-dos, also from queue workers (automation runs, isolation probes, config sync)
- across processes and replicas: changes write a revision to Valkey, polled every `ACTION_CENTER_REVISION_POLL_INTERVAL_MS` (default 2 s)
- a full refresh every `ACTION_CENTER_REFRESH_INTERVAL_MS` (default 60 s) for conditions without an event

Connected sessions are re-validated every `ACTION_CENTER_SESSION_REVALIDATE_INTERVAL_MS` (default 60 s) and disconnected when the session expired, was revoked or locked, or the user is no longer admin or manager. When the socket cannot connect, the console falls back to loading the view over REST every 30 s.

## Access

- Console: admins and managers (`canAccessUserManager`), users / OIDC / SAML authentication; console sessions see every workspace.
- REST: `GET /api/admin/action-center`, `POST /api/admin/action-center/silences` (`{ itemType, itemId?, audience: "self" | "everyone", until? }`), `DELETE /api/admin/action-center/silences/:id`. Admin or manager role (checked in the controller), PAT scope `action_center:admin`. Like the [Admin Overview](./admin-overview.md), PATs get no console-admin bypass: their view only contains items of workspaces the token's user is a member of (instance-wide items stay), and only to-dos of domains the token also has a scope for: setup / platform `clients:admin`, workspaces `clients:read` (configuration sync `clients:admin`), tickets `tickets:read`, agent automation `agent_chats:read`, deployments `deployments:read`, integrations `connections:admin`, webhooks `webhooks:admin`, updates `updates:admin`. Counts of a restricted view are based on the first 200 records per type.
- Socket: interactive console sessions only (no PATs, app tokens or the static credential).

Silences for everyone are published as webhook events `action_center.silence.created` and `action_center.silence.removed` (see [Webhooks](./webhooks.md#action-center-events)); personal silences stay private.

## Load

A recompute runs the sources one after another with at most three concurrent queries each and never more often than every 2 s; chatty events (chat messages and sessions, egress decisions, knowledge edits, attachments) do not trigger one.

## Related

- [Admin Overview](./admin-overview.md), [Tickets and workspaces](./tickets-and-workspaces.md), [Webhooks](./webhooks.md), [Application Updates](./application-updates.md)
- Shared implementation: `libs/domains/shared/backend/feature-action-center`, `libs/domains/shared/frontend/{data-access,feature}-action-center`
