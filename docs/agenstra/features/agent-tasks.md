# Agent tasks

Recurring tasks let an environment (agent) do something on a schedule: a daily report, a weekly dependency check,
an hourly health probe. A task is a prompt plus a cron schedule. When it is due, the agent runs it unattended in a
hidden session and the result shows up as a structured card in the agent's **main chat**, like ticket automation runs.

Tasks are managed in two ways:

- **Console** `/tasks/:clientId` (sidebar **Tasks**) with the same workspace picker as tickets and pages.
- **The agent itself** through the platform `agenstra` MCP server (`agenstra_tasks_*` tools). Ask the agent in chat,
  for example "check the open pull requests every weekday at nine and summarize them". An agent can only see and
  change its **own** tasks.

## Prerequisites

- Workspace access (same rule as tickets and chat plans) and the `agents:chats` scope for PATs; tasks are prompts the
  agent runs.
- A model (`provider/model`) per task. Tasks the agent creates without a model use the model of the chat it was asked in.
- For agent-managed tasks: the [agent context MCP](../ai-agents/context-mcp.md) must be active for the environment
  (manager URL, token secret, worker image with the bundled server). Console management works without it.

## Flow

```mermaid
sequenceDiagram
    participant U as Console
    participant O as OpenCode (worker)
    participant X as agenstra MCP (worker)
    participant M as Agent Manager
    participant C as Agent Controller
    participant Q as BullMQ (Redis)

    U->>C: REST /clients/:clientId/agents/:agentId/tasks
    O->>X: agenstra_tasks_create(...)
    X->>M: POST /api/agent-context/tasks (agent token)
    M->>C: agentTaskRequest (Socket.IO ack, workspace of the connection, authenticated agent)
    C->>C: validate, store agent_tasks (next_run_at)
    Q->>C: agent-task.coordinator (every 30 s)
    C->>Q: agent-task.unit per due occurrence
    Q->>C: agent-task.unit
    C->>M: chat (hidden -task-{taskId} session, unattended)
    M-->>C: result
    C-->>U: agentTaskRunChatUpsert (main chat card) + agentTaskUpsert (/tasks)
```

## Approval

Runs are unattended and every permission is allowed (like ticket automation), so a task only runs once a workspace
user approved what it does — its title, prompt, model, schedule and allowed handoff agents (the title is part of the
run prompt):

- Tasks created in the console, and tasks saved with the console editor (which submits all of these fields), are
  approved by that user. Partial user updates (e.g. the **Enabled** switch) never approve content the user did not
  submit.
- Tasks the **agent** creates, and any change by the agent to title, prompt, model, schedule or allowed handoff agents
  (or enabling it again), wait for approval: the `/tasks` page shows **Awaiting approval** and an **Approve** button
  (`POST /clients/:clientId/agents/:agentId/tasks/:taskId/approval` with the reviewed `updatedAt`; a task changed in
  between is refused with `409`). Unapproved tasks are never scheduled or run, also not with **Run now**. Disabling
  keeps the approval.
- Manual runs requested by the agent (`agenstra_tasks_run`) respect the minimum interval, so runs cannot be chained.
- A task never has more than one active run — running or waiting for a handoff response (database constraint).
- When the task lists **allowed handoff agents**, the approval alert says plainly that the task can hand off work to
  them without asking; approving the task approves that (see [Handoffs from task runs](#handoffs-from-task-runs)).

## Scheduling and reliability

- `agent_tasks.next_run_at` is the source of truth. The coordinator locks due rows (`FOR UPDATE SKIP LOCKED`),
  enqueues one unit job per occurrence and advances `next_run_at` in the same transaction; a failed enqueue rolls the
  claim back and is retried on the next tick.
- Each occurrence is identified by `(task_id, scheduled_for)`: the BullMQ job id is stable and `agent_task_runs` has a
  unique constraint, so retries and duplicate coordinator ticks never run the same occurrence twice.
- Occurrences missed while the controller was down collapse into **one** catch-up run.
- A task never runs twice at the same time; due occurrences are skipped while a run is in progress or waits for a
  handoff response. Turns that outlive `AGENT_TASK_RUN_TIMEOUT_MS` (plus a grace period) are marked failed; a run that
  waits for a handoff is bounded by `AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS`.
- Cron expressions have five fields and are evaluated in the task's IANA time zone (default `UTC`). Occurrences must be
  at least `AGENT_TASK_MIN_INTERVAL_MINUTES` apart; each agent has at most `AGENT_TASKS_MAX_PER_AGENT` tasks.
- **Run now** (console or `agenstra_tasks_run`) queues a manual occurrence; it also works for paused tasks.

## Runs

- Runs use the platform automation agent with the unattended session ruleset (no permission prompts, like ticket
  automation) and the `-task-{taskId}` session. Runs of one task share that session, so the agent sees its earlier runs.
- The run prompt carries the task title, schedule and instructions; instructions must be self-contained because the
  visible chat history is not part of the task session.
- Runs only get their pre-granted context (workspace and environment); additional ticket / knowledge requests are
  denied, because nobody can approve them during a run.
- Runs are streamed like plan mode and settle on the agent's final answer. Every chat event of the turn (prompt, thinking,
  tool calls, answer; streaming deltas omitted, long strings capped) is stored on the run and shown as the task's
  **session history** on the `/tasks` detail page (**View task** on a chat card jumps to that run). The chat card itself
  only shows status, trigger and schedule. The tail of the final answer (up to 4,000 characters) is kept for
  `agenstra_tasks_get`; usage is recorded as interaction kind `agent_task_run`.

## Handoffs from task runs

A run can hand off work to another agent of the workspace, but only to the agents a user approved for the task:

- **Allowed handoff agents** (`allowedHandoffAgentIds`, default none) are set in the task form (other agents of the
  same workspace only) or proposed by the agent through `agenstra_tasks_create` / `agenstra_tasks_update`. They are
  approved content like the prompt: the agent's proposal only takes effect once a user approved the task again.
- The run prompt names the approved agents. `agenstra_handoff_create` from the run is accepted only while the task is
  approved, the run is working and the target is on the list and still in the workspace; one handoff can be open per
  run, `AGENT_TASK_RUN_MAX_HANDOFFS` (3) in total. The platform resolves the run from the run's own session, never from
  anything the model sends.
- When the run's turn ends with an open handoff, the run is **Waiting for handoff** (`awaiting_handoff`) instead of
  finished. The response is delivered into the run's own session; the run reacts (part of its session history,
  shown with a response card linking to the target's handoff chat) and then ends, or waits for the next handoff.
- If the target is gone, the handoff fails, or the run waited longer than `AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS`, the run
  receives the failure message the same way, decides how to continue and ends normally.
- The target's handoff chat links back to the run and cannot hand the task on. Runs get no extra context grants for
  handoffs. See [Agent handoffs](./agent-handoffs.md#handoffs-from-task-runs).

## Agent tools

| Tool                    | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `agenstra_tasks_list`   | The agent's tasks with schedule, next / last run, status |
| `agenstra_tasks_get`    | One task with its recent runs and their output           |
| `agenstra_tasks_create` | Create a task (`title`, `prompt`, `cronExpression`, …)   |
| `agenstra_tasks_update` | Change fields of a task, e.g. pause it (`enabled=false`) |
| `agenstra_tasks_delete` | Delete a task and its run history                        |
| `agenstra_tasks_run`    | Queue an immediate run                                   |

In visible chats the tools follow the environment's OpenCode permission configuration, so a configuration that asks
before MCP tool calls lets the user confirm every change. Read-only plan sessions cannot use them.

## Security

- The manager accepts task calls only with the agent's context token and forwards them with the **authenticated**
  agent id; the controller scopes every lookup to the workspace bound to the manager connection and that agent. Tasks
  of other agents or workspaces are indistinguishable from missing ones.
- The controller answers `agentTaskRequest` only on its own manager connections and never forwards it to browsers.
- Console routes require workspace access; deleting a workspace deletes its tasks and runs.
- Allowed handoff agents are validated against the workspace when saved and again when a run hands off; a handoff
  response can never change the task, its approval, schedule or allowed agents (the run is an agent like any other:
  its own task changes clear the approval).

## REST API (controller)

| Method   | Route                                                       | Purpose                                         |
| -------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `GET`    | `/clients/:clientId/agent-tasks?agentId=`                   | Tasks of the workspace / an agent               |
| `POST`   | `/clients/:clientId/agents/:agentId/tasks`                  | Create                                          |
| `GET`    | `/clients/:clientId/agents/:agentId/tasks/:taskId`          | Task with recent runs                           |
| `PATCH`  | `/clients/:clientId/agents/:agentId/tasks/:taskId`          | Update                                          |
| `DELETE` | `/clients/:clientId/agents/:agentId/tasks/:taskId`          | Delete                                          |
| `GET`    | `/clients/:clientId/agents/:agentId/tasks/:taskId/runs`     | Run history (`limit` ≤ 50, `includeTranscript`) |
| `POST`   | `/clients/:clientId/agents/:agentId/tasks/:taskId/runs`     | Run now (`202`, `queued`; approved tasks only)  |
| `POST`   | `/clients/:clientId/agents/:agentId/tasks/:taskId/approval` | Approve a task the agent created / changed      |

## Configuration

See [Environment configuration](../deployment/environment-configuration.md#agent-tasks).
