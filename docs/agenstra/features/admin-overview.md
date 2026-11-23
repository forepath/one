# Admin Overview

A dashboard of the instance's key figures for administrators and managers, combined over all workspaces or for one workspace.

## Overview

Administrators and managers open the admin mode (**Mode → Admin**); its home page is the **Overview** (`/overview`, one workspace at `/overview/:clientId`) in the agent console. The page is laid out like the [audit page](./usage-statistics.md):

- **Summary bar**: workspaces, active agents, messages, tokens, cost (USD) and open tickets. The open tickets card turns to a warning when autonomous ticket runs failed in the period.
- **Workspace chip** in the page header (as on the tickets, pages and tasks boards): shows the viewed workspace or **All workspaces** (the start view) and opens the workspace switch, whose first row is **All workspaces**.
- **Filter strip**: period (`From`, `To`, default the last 30 days) and grouping (`Day` or `Hour`). The applied filters are kept in the URL (`?f=`) and survive a workspace switch, so a view can be shared or reloaded.
- **Panels**:
  - **Messages over time**: chat messages per day or hour, as on the audit page.
  - **Activity in period**: active agents, active users (with chat activity in the period), messages, tokens and cost.
  - **Tickets and automation**: open tickets (to do, in progress, prototype), tickets in progress, autonomous ticket runs started in the period (with failed, timed out or escalated ones) and runs pending or running now.
  - **Pipelines and tasks**: pipeline runs created in the period (with failed or timed out ones), scheduled agent task runs started in the period (with failed ones) and knowledge pages.
  - **Security in period** and **Security events over time**: message drops and flags, blocked destinations and observed (would block) destinations.
  - **Workspaces** (all workspaces only): the figures per workspace side by side, most messages first. Selecting a row narrows the page to that workspace.

Each area panel links to its page (audit, tickets, pipelines), scoped to the selected workspace when one is selected.

The chat and security totals are the same figures as on the audit page for the same workspace and period. Ticket and knowledge figures are the current state; run and chat figures cover the period.

## Workspaces and combined numbers

Agenstra has no tenants; the workspace is its scope. With **All workspaces** the summary and panels show the combined numbers of every workspace (sums; active users are counted once even when they work in several workspaces) and the per-workspace comparison. With a workspace selected in the chip (or a row of the comparison) they show that workspace only.

## Access

- Route guard: `adminGuard` (admins and managers); first item of the admin sidebar and the page admins and managers land on after login.
- API: `GET /api/admin/overview?clientId=&from=&to=&groupBy=` (admin or manager role checked in the controller, API key mode allowed). PATs need the `statistics:admin` scope, which only admins and managers can grant, and see their member workspaces only (no console-admin bypass for PATs).
  - `clientId` must be an accessible workspace (`403` otherwise).
  - `from` / `to` are `YYYY-MM-DD` (default the last 30 days); `groupBy` is `day` (at most 366 days) or `hour` (at most 31 days). Other values return `400`.

The response carries the combined `metrics`, the `series` / `securitySeries` of the audit summary and one entry per workspace in `workspaces`. See the [OpenAPI spec](../../../libs/domains/agenstra/backend/feature-agent-controller/spec/openapi.yaml) (`AdminOverviewResponse`).

## Related

- [Usage Statistics](./usage-statistics.md) for the audit page and the statistics behind the chat and security figures
- [Tickets and Workspaces](./tickets-and-workspaces.md), [Ticket automation](./ticket-automation.md), [Deployments](./deployment.md), [Agent tasks](./agent-tasks.md)
- [Authentication](./authentication.md) for the admin and manager roles and PAT scopes
