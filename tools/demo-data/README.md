# @forepath/demo-data

Nx project **`demo-data`**: seeds plausible random demo data into the **Decabill** and **Agenstra** databases of a local container stack, and removes it again.

The seeders assume the stacks were started with each app's `start-containers` target, so the containers use the values in `.start-containers.env`:

```bash
nx run decabill-backend-billing-manager:start-containers
nx run agenstra-backend-agent-manager:start-containers
nx run agenstra-backend-agent-controller:start-containers
```

Wait until the API containers are healthy before seeding. They run the migrations on start, and the seeder refuses to run against an incomplete schema.

## Usage

```bash
nx run demo-data:seed                     # Decabill + Agenstra
nx run demo-data:seed:decabill
nx run demo-data:seed:agenstra

nx run demo-data:reset                    # remove all demo rows again
nx run demo-data:reset:decabill
nx run demo-data:reset:agenstra
```

CLI (after `nx run demo-data:build`, from the repository root):

```bash
node tools/demo-data/dist/src/cli.js seed decabill --seed 42
node tools/demo-data/dist/src/cli.js seed all --dry-run --sql-out tmp/demo-sql
node tools/demo-data/dist/src/cli.js reset agenstra
```

| Option            | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `--seed <number>` | Random seed; the same seed produces the same data set             |
| `--dry-run`       | Build SQL only; no container is contacted                         |
| `--sql-out <dir>` | Write the generated SQL scripts (useful for review and debugging) |

- **`seed`** first removes previously seeded rows and then inserts a fresh data set, so it can be repeated.
- **`reset`** only removes rows created by this tool. Every seeded row has an id starting with **`5eedda7a-`**. Real data in the same database is never touched.
- Each database is written in a single transaction (`psql --single-transaction`). If any statement fails, nothing is applied.

## How it connects

The compose files do not publish the Postgres ports. The tool runs SQL through `docker exec <container> psql`. It reads database names and `ENCRYPTION_KEY` from each app's `.start-containers.env`, and falls back to the compose defaults for empty values. Encrypted columns use the same AES-256-GCM format as `@forepath/shared/backend/util-crypto`.

| Variable                                           | Default                           |
| -------------------------------------------------- | --------------------------------- |
| `DEMO_DATA_DECABILL_POSTGRES_CONTAINER`            | `billing-manager-postgres`        |
| `DEMO_DATA_AGENSTRA_CONTROLLER_POSTGRES_CONTAINER` | `agent-controller-postgres`       |
| `DEMO_DATA_AGENSTRA_MANAGER_POSTGRES_CONTAINER`    | `agent-manager-postgres`          |
| `DEMO_DATA_AGENSTRA_MANAGER_ENDPOINT`              | `http://agent-manager-api:<PORT>` |
| `DEMO_DATA_AGENSTRA_CONNECT_NETWORK`               | `true`                            |

## Accounts

All demo accounts use the password **`Demo-Passw0rd!`**. Accounts with TOTP use the base32 secret **`KRUGKIDROVUWG2ZAMJZG653OEBTG66BAJJ2W24DT`**. Pending email confirmations and password resets use the code **`DEMO42`**. These are public demo values. Never use them outside local environments.

One account exists per state (local part = state key):

| Account                       | State                                   |
| ----------------------------- | --------------------------------------- |
| `admin`                       | Administrator                           |
| `admin-totp`                  | Administrator with authenticator app    |
| `user`                        | Active user                             |
| `user-email-2fa`              | Email 2FA opt-in                        |
| `user-totp`                   | Authenticator app                       |
| `user-unconfirmed`            | Registered, email not confirmed         |
| `user-locked`                 | Locked                                  |
| `user-password-reset`         | Password reset pending                  |
| `user-password-reset-expired` | Password reset expired                  |
| `user-sso`                    | Keycloak-linked (no local password)     |
| `user-sessions-revoked`       | Sessions revoked (bumped token version) |
| `user-billing-day`            | Fixed billing day of month              |
| `controller` (Agenstra only)  | Service account role                    |

- **Decabill:** `<state>@<tenant>.decabill.example` for **every** tenant (`default` plus `TENANTS`). Send the matching `X-Tenant` header, or use the tenant's console URL.
- **Agenstra:** `<state>@agenstra.example`.

With `DISABLE_FORCE_LOGIN_2FA=false` (the default), every password login also asks for an emailed code. Read it in MailHog (Decabill: http://localhost:8026, Agenstra: http://localhost:8025).

## What gets seeded

### Decabill (per tenant)

- **Customers:** customer profiles with complete, incomplete and missing data; VAT ids in all validation states; trust levels; auto billing on and off. Customers come from DE, AT, NL, FR, PL, CH and US, so domestic VAT, reverse charge, OSS and third-country tax modes all appear.
- **Catalog:**
  - Service types and plans: hourly, daily, monthly, quarterly and yearly; billing-only; reduced VAT; inactive plans.
  - Meters, add-ons and cloud-init configs.
  - Promotions: running, expired, upcoming, paused and capped.
- **Subscriptions:** every status. Server items are provisioned with hostname, IP and server snapshot, plus some failed and pending items. Also add-ons in every status, config changes, usage records, promotion redemptions, backorders and open positions.
- **Invoices:** every status, with line items, payment attempts, refunds and promotion applications.
- **Offers:** every status.
- **Projects:** milestones, tickets in every status and priority (with sub-tickets), comments, activity, and billed and unbilled time entries.
- **Back office:** suppliers, contracts and supplier invoices; DATEV debtor/creditor accounts and exports; OSS ledger; audit logs; webhooks with deliveries; email delivery log; personal access tokens.

**Dummy provisioning:** server products use the provider id `demo`. It is not a registered provisioning module, so no remote resources are ever created. The provisioning job just marks such items active. Live server lookups fail and fall back to the seeded snapshot. Start, stop and restart fail, because there is no server.

### Agenstra

- **Agent manager:** six environments (agents) of every container type. Each has chat sessions and history, environment variables, deployment configurations and runs, and synced filter rules. Agents have no container, so the history is readable but new chat messages cannot run.
- **Controller:**
  - **Workspaces:** three point to the local agent-manager; one remote Keycloak workspace is offline.
  - Members with workspace roles, and agent credentials.
  - **Tickets:** every status and priority, sub-tickets, comments, activity, AI body generation sessions.
  - **Automation:** settings, runs in every final state with steps and leases.
  - **Knowledge:** folders, pages and relations.
  - **Statistics:** about 45 days of chat usage, filter drops and flags, entity events.
  - **Configuration and integrations:** console filter rules with sync states, OpenCode workspace configs with MCP allow/deny lists, Atlassian imports, webhooks, the email log and personal access tokens.

The local controller and manager run in separate compose networks. After seeding, the tool runs `docker network connect agent-manager-network` for the controller API, worker and scheduler, so workspaces can reach `http://agent-manager-api:3000`. `start-containers` recreates the containers, so seed again (or connect again) after restarting them. Set `DEMO_DATA_AGENSTRA_CONNECT_NETWORK=false` to skip this step.

## Background jobs

The seeded data is shaped so that the schedulers leave it mostly alone:

- Next billing dates are at period end.
- Open backorders have a future retry date.
- Accepted offers are already fulfilled.
- Automation runs only on tickets that are not open.
- Atlassian imports are disabled.

A few transitional states are processed by the running jobs within minutes, as they would be in production:

- Decabill: pending instant cancellation, pending config changes, pending add-ons, and hourly/daily subscriptions.
- Agenstra: the automation scheduler only picks up approved open tickets, and the seed leaves none of those.

Search results come from OpenSearch, which is filled on the next reindex run (`SEARCH_REINDEX_INTERVAL`). List pages read Postgres and show the data immediately.

## Development

```bash
nx run demo-data:build
nx run demo-data:test
```

Seeders live in `src/lib/decabill` and `src/lib/agenstra`. Shared helpers live in `src/lib/core`: SQL building, encryption, account states, random data and `docker exec` access. When a migration changes a seeded table, update the matching builder and the table order in `*.tables.ts`.
