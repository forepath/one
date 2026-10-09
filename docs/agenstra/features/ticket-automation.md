# Ticket automation

Workspace tickets can run **autonomous prototyping**: the agent controller schedules work, prepares the agent’s Git workspace, drives the remote agent through chat turns, optionally runs verifier commands, then commits and pushes. Runs are observable via REST, realtime board events, and chat-side automation payloads.

For ticket boards, migration, and API entry points, see [Tickets and Workspaces](./tickets-and-workspaces.md).

## Prerequisites

Automation only starts when **all** of the following hold:

1. **Per-ticket automation** `ticket_automation.eligible` is true (exposed as automation eligibility on the ticket; configure via `GET/PATCH /tickets/{ticketId}/automation`).
2. **Agent autonomy** At least one row in `client_agent_autonomy` exists for the workspace with `enabled = true` for the agent that will run the work. Configure via `GET/PUT /clients/{id}/agents/{agentId}/autonomy` (workspace managers; see OpenAPI for `403` cases).
3. **Ticket status** Status is `todo` or `in_progress`.
4. **Allowed agents** If `allowed_agent_ids` on the ticket automation row is non-empty, the candidate agent must appear in that list. If it is empty, any agent with autonomy enabled for the workspace can be selected.
5. **Approval** If `requires_approval` is true, the ticket must be approved (`approved_at` set) and the ticket must not have been edited after the approval baseline (`updated_at <= approval_baseline_ticket_updated_at`). Use `POST .../automation/approve` and `.../unapprove` as needed.
6. **No blocking run or lease** No automation run with status `running` for the ticket, and no active automation lease whose `expires_at` is still in the future.
7. **Retry window** `next_retry_at` is null or in the past (after failures the controller may set a short backoff before the ticket is eligible again).

The controller picks candidates with a SQL query that joins `tickets`, `ticket_automation`, and `client_agent_autonomy` (`enabled = true`). If several agents have autonomy enabled and `allowed_agent_ids` is empty, the same ticket can appear as multiple candidates (one per agent); narrowing `allowed_agent_ids` pins the workload to specific agents.

## Background jobs (BullMQ)

The **backend agent controller** registers a repeatable **coordinator** job on Redis (BullMQ). Each coordinator tick enqueues at most **N** **unit** jobs (one per ticket candidate). Workers process unit jobs in parallel; BullMQ `jobId` deduplication and DB leases prevent double-starts.

Operator environment variables (see [Environment configuration](../deployment/environment-configuration.md) and [Background jobs](../deployment/background-jobs.md)):

- `AUTONOMOUS_TICKET_SCHEDULER_INTERVAL_MS`. Coordinator repeat interval in milliseconds (default `60000`).
- `AUTONOMOUS_TICKET_SCHEDULER_BATCH_SIZE`. Maximum candidates enqueued per coordinator tick (default `5`).

There is no separate “start run” HTTP call for this path: eligible tickets are picked up when a worker processes their unit job.

## Run phases (high level)

1. **Lease** A pessimistic lease is created so concurrent ticks do not double-start work; lease duration comes from autonomy `max_runtime_ms` (default one hour).
2. **Workspace prep** Clean workspace and `fetch` on the agent container; choose base branch from `default_branch_override` or repository defaults (`main`, then `master`, then first local branch, else `main`).
3. **Branch strategy** From ticket automation settings:
   - `reuse_per_ticket` (default): branch name `automation/ticket/{first 8 chars of ticket UUID}`; reuse if it exists, otherwise create from base.
   - `new_per_run`: ephemeral branch `automation/run/{first 8 chars of run UUID}` per run.
   - `force_new_automation_branch_next_run`: with `reuse_per_ticket`, forces one ephemeral branch for the next run, then clears the flag.
4. **Optional pre-improve** If autonomy `pre_improve_ticket` is true, one chat turn asks the agent to clarify the ticket only (no implementation).
5. **Implementation loop** Up to `max_iterations` remote chat turns (default `20`). Each turn uses an OpenCode automation session with session-scoped allow-all permissions and structured `json_schema` turn status. The loop exits successfully only when structured output reports `status: "complete"`.
6. **Verification** If a `verifier_profile` with `commands` is configured, those commands run in the agent workspace (bounded timeout); any non-zero exit fails the run.
7. **Finalize** Stage changes, generate a Conventional-Commits-style subject (with fallback), `git commit` and `git push` unless the tree is already clean.
8. **Success** Run status `succeeded`, ticket status set to **`prototype`**, failure counters cleared, lease released, board and activity events emitted.

### Unattended OpenCode sessions

Reserved resume-session suffixes (`-ticket-auto-pre`, `-ticket-auto-loop`, `-ticket-auto-commit-msg`) create **hidden ephemeral** OpenCode sessions that:

- Apply a session-scoped permission ruleset (`allow` for all actions) so interactive ask/deny from the worker UI config does not block the run.
- Auto-reply residual permission asks (`always`) and questions on those sessions only; interactive chat suffixes are unchanged.
- Force the platform agent `agenstra-automation` and skill `agenstra-ticket-automation` (injected at config sync so UI overlays cannot remove them). The skill documents the structured-status protocol; completion detection uses structured output only.
- The platform skill is installed only at `/opt/agenstra/skills/agenstra-ticket-automation/SKILL.md`, with root ownership and runtime-user read access, before applying worker config. Its directory is root-owned and not writable by the worker; ancestors must be root-owned, non-symlink directories without group/world write access. Sync atomically replaces the skill file without following existing file symlinks or hard links, and rejects unsafe directories. The root installer uses an absolute system launcher and a clean environment with a system-only `PATH`, never worker-controlled executables. Existing worker-owned skill directories are secured on resync. Its absolute path is registered in `skills.paths`; no platform files are written into `/app/.opencode`. This avoids changing `OPENCODE_CONFIG_DIR` (which introduces a separate config precedence layer). Installation failures fail the sync explicitly. The platform wire revision is bumped so existing environments resync. Older project-local copies are not automatically deleted: remove only verified Agenstra-generated copies after checking for project edits or Git tracking, and preserve all other `.opencode` content.
- Keep transcripts out of the user’s primary chat history; run progress still surfaces via automation chat cards / board events.

Ticket approval and agent autonomy prerequisites still apply. Only reserved automation sessions bypass interactive permission prompts.

The manager's `opencode-config-sync-progress` tests include opt-in worker security checks. Set `AGENSTRA_WORKER_SECURITY_TEST_IMAGE` to a locally available worker image when running that suite to verify link handling, ownership, read-only worker access, and protection against worker-controlled executables. Each check uses a disposable, network-disabled container without host mounts; these checks are skipped when the variable is unset.

Remote chat turns and commit-message generation are recorded in usage statistics as `autonomous_ticket_run_turn` and `autonomous_ticket_commit_message` interaction kinds (see [Usage statistics](./usage-statistics.md)).

## Failures and retries

Failures map to a terminal run status (`failed`, `timed_out`, `escalated`, `cancelled`) and may adjust ticket status. When policy says **requeue**, `next_retry_at` is set to approximately **one minute** ahead so the scheduler does not hot-loop; `consecutive_failure_count` increments.

Examples (not exhaustive): missing structured completion status or budget-related timeout tend to move the ticket back toward `todo` and requeue; human escalation stops requeue; lease contention skips starting a run but schedules a retry. Product policy is centralized in code (`routeAutomationFailure` in the agent-controller library); adjust there when behavior changes.

## HTTP and realtime

- **REST** `GET/PATCH /tickets/{ticketId}/automation`, approve/unapprove, list runs, run detail, cancel (all under `/api` in the deployed controller). See [Backend Agent Controller](../applications/backend-agent-controller.md).
- **Autonomy** `GET/PUT .../clients/{id}/agents/{agentId}/autonomy` and enabled-agent listing.
- **Manager (proxied)** `POST .../vcs/workspace/prepare-clean` and `POST .../automation/verify-commands` support automation; see [Version control](./version-control.md).
- **Realtime** `ticketAutomationUpsert`, `ticketAutomationRunUpsert`, `ticketAutomationRunStepAppended` on the `tickets` namespace; chat clients may also see automation payloads on `clients`. See [WebSocket communication](./websocket-communication.md) and the AsyncAPI.

## Related documentation

- [Tickets and Workspaces](./tickets-and-workspaces.md) Board, migration, automation API surface
- [Backend Agent Controller](../applications/backend-agent-controller.md) HTTP routes and WebSocket namespaces
- [Frontend Agent Console](../applications/frontend-agent-console.md) Console entry points
- [Version control](./version-control.md) Workspace prep and verify-commands
- [WebSocket communication](./websocket-communication.md) `tickets` and `clients` events
- [Environment configuration](../deployment/environment-configuration.md) Scheduler and commit-message timeout variables
