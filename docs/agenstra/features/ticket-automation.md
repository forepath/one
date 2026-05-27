# Ticket automation

Workspace tickets can run **autonomous prototyping**: the agent controller schedules work, prepares the agent’s Git workspace, drives the remote agent through chat turns, optionally runs verifier commands, then commits and pushes. Runs are observable via REST, realtime board events, and chat-side automation payloads.

For ticket boards, migration, and API entry points, see [Tickets and Workspaces](./tickets-and-workspaces.md).

## Prerequisites

Automation only starts when **all** of the following hold:

1. **Per-ticket automation** – `ticket_automation.eligible` is true (exposed as automation eligibility on the ticket; configure via `GET/PATCH /tickets/{ticketId}/automation`).
2. **Agent autonomy** – At least one row in `client_agent_autonomy` exists for the workspace with `enabled = true` for the agent that will run the work. Configure via `GET/PUT /clients/{id}/agents/{agentId}/autonomy` (workspace managers; see OpenAPI for `403` cases).
3. **Ticket status** – Status is `todo` or `in_progress`.
4. **Allowed agents** – If `allowed_agent_ids` on the ticket automation row is non-empty, the candidate agent must appear in that list. If it is empty, any agent with autonomy enabled for the workspace can be selected.
5. **Approval** – If `requires_approval` is true, the ticket must be approved (`approved_at` set) and the ticket must not have been edited after the approval baseline (`updated_at <= approval_baseline_ticket_updated_at`). Use `POST .../automation/approve` and `.../unapprove` as needed.
6. **No blocking run or lease** – No automation run with status `running` for the ticket, and no active automation lease whose `expires_at` is still in the future.
7. **Retry window** – `next_retry_at` is null or in the past (after failures the controller may set a short backoff before the ticket is eligible again).

The controller picks candidates with a SQL query that joins `tickets`, `ticket_automation`, and `client_agent_autonomy` (`enabled = true`). If several agents have autonomy enabled and `allowed_agent_ids` is empty, the same ticket can appear as multiple candidates (one per agent); narrowing `allowed_agent_ids` pins the workload to specific agents.

## Background jobs (BullMQ)

The **backend agent controller** registers a repeatable **coordinator** job on Redis (BullMQ). Each coordinator tick enqueues at most **N** **unit** jobs (one per ticket candidate). Workers process unit jobs in parallel; BullMQ `jobId` deduplication and DB leases prevent double-starts.

Operator environment variables (see [Environment configuration](../deployment/environment-configuration.md) and [Background jobs](../deployment/background-jobs.md)):

- `AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS` – Coordinator repeat interval in milliseconds (default `60000`).
- `AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE` – Maximum candidates enqueued per coordinator tick (default `5`).

There is no separate “start run” HTTP call for this path: eligible tickets are picked up when a worker processes their unit job.

## Run phases (high level)

1. **Lease** – A pessimistic lease is created so concurrent ticks do not double-start work; lease duration comes from autonomy `max_runtime_ms` (default one hour).
2. **Workspace prep** – Clean workspace and `fetch` on the agent container; choose base branch from `default_branch_override` or repository defaults (`main`, then `master`, then first local branch, else `main`).
3. **Branch strategy** – From ticket automation settings:
   - `reuse_per_ticket` (default): branch name `automation/ticket/{first 8 chars of ticket UUID}`; reuse if it exists, otherwise create from base.
   - `new_per_run`: ephemeral branch `automation/run/{first 8 chars of run UUID}` per run.
   - `force_new_automation_branch_next_run`: with `reuse_per_ticket`, forces one ephemeral branch for the next run, then clears the flag.
4. **Optional pre-improve** – If autonomy `pre_improve_ticket` is true, one chat turn asks the agent to clarify the ticket only (no implementation).
5. **Implementation loop** – Up to `max_iterations` remote chat turns (default `20`). The agent must include the exact completion marker `AGENSTRA_AUTOMATION_COMPLETE` in assistant text to exit the loop successfully.
6. **Verification** – If a `verifier_profile` with `commands` is configured, those commands run in the agent workspace (bounded timeout); any non-zero exit fails the run.
7. **Finalize** – Stage changes, generate a Conventional-Commits-style subject (with fallback), `git commit` and `git push` unless the tree is already clean.
8. **Success** – Run status `succeeded`, ticket status set to **`prototype`**, failure counters cleared, lease released, board and activity events emitted.

Remote chat turns and commit-message generation are recorded in usage statistics as `autonomous_ticket_run_turn` and `autonomous_ticket_commit_message` interaction kinds (see [Usage statistics](./usage-statistics.md)).

## Failures and retries

Failures map to a terminal run status (`failed`, `timed_out`, `escalated`, `cancelled`) and may adjust ticket status. When policy says **requeue**, `next_retry_at` is set to approximately **one minute** ahead so the scheduler does not hot-loop; `consecutive_failure_count` increments.

Examples (not exhaustive): missing completion marker or budget-related timeout tend to move the ticket back toward `todo` and requeue; human escalation stops requeue; lease contention skips starting a run but schedules a retry. Product policy is centralized in code (`routeAutomationFailure` in the agent-controller library); adjust there when behavior changes.

## HTTP and realtime

- **REST** – `GET/PATCH /tickets/{ticketId}/automation`, approve/unapprove, list runs, run detail, cancel (all under `/api` in the deployed controller). See [Backend Agent Controller](../applications/backend-agent-controller.md).
- **Autonomy** – `GET/PUT .../clients/{id}/agents/{agentId}/autonomy` and enabled-agent listing.
- **Manager (proxied)** – `POST .../vcs/workspace/prepare-clean` and `POST .../automation/verify-commands` support automation; see [Version control](./version-control.md).
- **Realtime** – `ticketAutomationUpsert`, `ticketAutomationRunUpsert`, `ticketAutomationRunStepAppended` on the `tickets` namespace; chat clients may also see automation payloads on `clients`. See [WebSocket communication](./websocket-communication.md) and the AsyncAPI.

## Related documentation

- [Tickets and Workspaces](./tickets-and-workspaces.md) – Board, migration, automation API surface
- [Backend Agent Controller](../applications/backend-agent-controller.md) – HTTP routes and WebSocket namespaces
- [Frontend Agent Console](../applications/frontend-agent-console.md) – Console entry points
- [Version control](./version-control.md) – Workspace prep and verify-commands
- [WebSocket communication](./websocket-communication.md) – `tickets` and `clients` events
- [Environment configuration](../deployment/environment-configuration.md) – Scheduler and commit-message timeout variables
