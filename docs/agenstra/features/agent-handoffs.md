# Agent handoffs

An agent can hand a task over to another agent (environment) of the **same workspace**, for example a backend agent
asking a frontend agent to adapt the UI to a new endpoint. The target agent works on it in a **new chat**, and the
requesting agent always gets a response back where the handoff was made: the chat, or the
[scheduled task run](./agent-tasks.md#handoffs-from-task-runs) a user approved handoffs for.

Handoffs run between the main agents of a workspace. They are not the subagents an agent may start through OpenCode.

## Knowing the peers

Agents decide on their own whether to gather information from, or offload work to, another agent. They see:

- **Metadata** of every other agent of the workspace (`agenstra_handoff_agents`): name, description, container type,
  repository, and the **handoff profile**.
- **Handoff profile**: what the environment is responsible for and what it can take over. It is edited in the console
  (**Update Environment** → **Handoff profile**) or by the agent itself (`agenstra_handoff_profile_update`); the
  listing reminds an agent whose own profile is still empty.
- **Missing profiles are generated on request** (`agenstra_handoff_profile_get`): the peer describes itself in a
  hidden, read-only session (`-handoff-profile`, explore tools only) with a fixed platform prompt, and the answer is
  stored as its profile. Nothing of the requesting agent reaches the peer, so the request cannot instruct it.
  Concurrent requests share one generation; a profile written meanwhile wins. If generation takes longer than 150 s
  the tool says so and the profile is stored once it is done.

## Where handoffs are possible

A handoff must always be answered in the context that asked for it. The MCP call itself carries no session, so the
agent-manager attributes it to the agent's **running turns** (tracked by the OpenCode runtime for every prompt):

| Calling context                                             | Result                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| One visible chat (primary, user or handoff chat) is working | Accepted; the response goes to exactly that chat                                                        |
| A run of an approved scheduled task is working              | Accepted only to the agents a user approved for the task; the run waits and continues with the response |
| Ticket automation, plan or helper session                   | Refused: the session ends before a response arrives                                                     |
| A handoff chat whose handoff came from a task run           | Refused: the user approved that run's targets, not further hops                                         |
| Several sessions of the agent are working at the same time  | Refused: the requesting context is ambiguous                                                            |

Refusals are returned as tool errors, so the agent can decide how to continue (do the work itself, ask the user, retry
later). For task runs the manager only forwards the task id taken from the run's own session; the controller resolves
the running run and checks the approval and the targets itself (see [Handoffs from task runs](#handoffs-from-task-runs)).

## How it looks in the console

- **Outgoing:** the `Hand off task` tool call in the requesting chat shows the target agent, the task and an
  **Open handoff chat** button. This works in any chat, not only the primary one.
- **Incoming:** the target agent gets a regular chat (marked **(handoff)** in the chat switcher). Its first message
  is rendered as a handoff card with the source agent, the task and an **Open requesting chat** button, or **Open task
  run** (tasks page, that run) when a task run handed it over.
- **Response:** the answer arrives in the requesting chat as a handoff response card (status, response, **Open
  handoff chat**) and starts a new turn of the requesting agent, which continues its work with it. For task runs both
  the outgoing handoff and the response card appear in the run's session history on the tasks page.

New handoff chats appear in the chat switcher as soon as there is activity in them.

## Flow

```mermaid
sequenceDiagram
    participant A as Agent A (OpenCode + agenstra MCP)
    participant M as Agent Manager
    participant C as Agent Controller
    participant Q as BullMQ (Valkey)
    participant B as Agent B

    A->>M: POST /api/agent-context/handoffs (agent token)
    M->>M: resolve requesting chat from A's running turns
    M->>C: agentHandoffRequest create + sourceChatId (workspace of the connection)
    C->>M: create chat kind=handoff on B
    C->>Q: agent-handoff.unit
    C-->>A: handoffId, targetChatId (tool result)
    Q->>C: agent-handoff.unit
    C->>B: handoff message in the new chat
    B->>M: agenstra_handoff_respond
    M->>C: agentHandoffRequest respond
    C->>A: response message in the source chat
```

## Response guarantee

- The response is a new message in the requesting chat and starts a **turn of the requesting agent**, which continues
  the work that depended on it. The turn uses the model that chat was using. If a turn is still running in that chat,
  the response waits for it (prompts of one session run one after another).

- The target is asked to call `agenstra_handoff_respond` exactly once. If a turn ends without a response, the
  controller sends a repair prompt into the same chat (hidden, like chat plan repair turns), up to two times.
- If the agent still did not respond, the tail of its last answer becomes the response. If it gave no answer at all,
  or its turn failed or timed out, the handoff fails, and the failure is delivered as the response.
- Delivery is retried by BullMQ and by the coordinator (`agent-handoff.coordinator`, every minute). The coordinator
  also fails handoffs whose worker vanished (restart) and re-queues lost units. A response counts as delivered as soon
  as the manager accepted the message, so a long turn of the requesting agent never receives it twice.
- The response only ever goes to the chat (or task run) the handoff was made in. If the user deleted that chat
  meanwhile, the run already ended, or every delivery attempt failed, the handoff is marked `undeliverable`;
  `agenstra_handoff_get` reports this with `deliveryFailureMessage`. It is never redirected anywhere else.
- If the target agent or its handoff chat disappears, the handoff fails with a message saying so, which is delivered
  to the requesting chat. A target that no longer exists when the handoff is created is a tool error right away.

## Handoffs from task runs

Scheduled [tasks](./agent-tasks.md) run unattended, so a run may only hand off work a user explicitly allowed:

- The task lists **allowed handoff agents** (`allowedHandoffAgentIds`, empty by default = no handoffs), set in the
  task form or proposed by the agent (`agenstra_tasks_create` / `agenstra_tasks_update`). Only other agents of the
  same workspace can be set. The list is approved content: any change by the agent clears the approval, and the
  approval alert names the agents the task will hand off to without asking.
- A run (`-task-{taskId}` session) may call `agenstra_handoff_create` only while the task is approved, the run is
  working, and the target is on the list **and** still an agent of the workspace. Deleted or moved agents do not
  count. One handoff of a run can be open at a time, `AGENT_TASK_RUN_MAX_HANDOFFS` (3) in total.
- When the run's turn ends with a handoff open, the run becomes **Waiting for handoff** (`awaiting_handoff`). It still
  is the task's one active run: no other run starts, and the minimum interval keeps counting from its start.
- The response is delivered into the **run's own hidden session**, never into a visible chat. The run reacts in a new
  turn that is part of its transcript; it ends once no handoff is open anymore.
- If the target is gone, the handoff failed, or the run waited longer than `AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS`
  (default 60 minutes; the handoff is then failed), the failure message is delivered into the run the same way, so
  the run decides how to continue and then ends normally. If even that delivery is impossible, the run ends failed
  with the reason.
- The handoff chat on the target is a normal visible chat; it cannot hand the task on (no further hops). Runs get no
  extra context grants for handoffs, and nothing a peer writes can change the task, its approval, schedule or targets:
  a run trying to change its task through `agenstra_tasks_update` clears the approval like any agent change.

## Agent tools

| Tool                              | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `agenstra_handoff_agents`         | Other agents of the workspace with metadata and profile, plus own entry |
| `agenstra_handoff_profile_get`    | Metadata + profile of one peer; generates a missing profile first       |
| `agenstra_handoff_profile_update` | Set the own handoff profile (empty clears it)                           |
| `agenstra_handoff_create`         | Hand over a task (`targetAgentId`, `title`, `message`, opt. `model`)    |
| `agenstra_handoff_get`            | Status / response of a handoff the agent sent or received               |
| `agenstra_handoff_respond`        | Answer a received handoff (`status` completed/failed, `response`)       |

The message must be self-contained, because the target does not see the requesting chat. The target turn uses the
model the target was last used with in a visible chat (else the requester's), unless `model` is given. Read-only plan
sessions cannot use the tools (and every hidden session except approved task runs is refused, see above). In visible
chats they follow the environment's OpenCode permission configuration.

## Security and limits

- The manager accepts handoff calls only with the agent's context token and forwards them with the **authenticated**
  agent id. The controller resolves the workspace from the manager connection and only accepts targets with stored
  credentials in **that** workspace. A handoff is never possible across workspaces, and foreign handoffs look like
  missing ones.
- Peer-written text (the task, the response) is delimited as data after the fixed platform instructions; platform
  tags inside it are neutralized and the receiving agent is told it comes from another agent, not from a user.
  Handoff cards show it as plain text, so nothing can be hidden from the user.
- Reacting to a delivered response counts as part of the same chain (depth), so agents cannot hand work back and
  forth endlessly.
- Calls carry no session, so a call is attributed to whatever single context of the agent is working. Code running
  inside the worker at that moment (for example started earlier by the agent itself) is attributed the same way;
  for task runs it is still limited to the agents a user approved for the task.
- Responses for task runs are only delivered while the task is still approved and still lists the target; if a user
  or the agent changed that while the run waited, the response is not delivered and the run ends with the reason.
- Profiles: an agent can only write its own profile; generation only fills an **empty** profile of a peer of the same
  workspace, with that peer's own self-description.
- Only the target can respond, and only once. Users cannot create chats of
  kind `handoff` through the API.
- Open handoffs per workspace (`AGENT_HANDOFFS_MAX_ACTIVE_PER_WORKSPACE`) and chain depth (`AGENT_HANDOFF_MAX_DEPTH`)
  are bounded, so agents cannot hand tasks back and forth forever. Task runs: one open handoff, a few in total
  (`AGENT_TASK_RUN_MAX_HANDOFFS`), no further hops from the handoff chat they create.
- Usage is recorded as interaction kind `agent_handoff`.

## Configuration

See [Environment configuration](../deployment/environment-configuration.md#agent-handoffs).
