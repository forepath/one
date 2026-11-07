# Chat plan mode

Operators can turn the current chat composer prompt (plus selected context) into an **explore-then-plan** workflow. A hidden OpenCode session investigates the repository with **explore-only** permissions, a chat-scoped timeline card shows a single human-readable status plus plan title, a detail modal supports refine, and **Execute plan** injects the plan into the same visible chat.

This is an Agenstra productivity feature built on OpenCode (not a native OpenCode “plan mode” product API). It mirrors ticket-automation durability and hydrate patterns, but is user-triggered and chat-session scoped.

## Prerequisites

- Authenticated console user with access to the client and `agent_chats:read` scope (`agent_chats:write` to edit or cancel plans)
- Selected agent environment with a working OpenCode worker and up-to-date config sync (platform plan agent/skill injected)
- Non-empty composer prompt and a selected visible chat session (`primary` or `user`)

## Context injection

Plan creation uses the **same composer context** as Send (`ContextInjectionPayload`): workspace, related environments, ticket SHAs, knowledge SHAs, and auto-enrichment. The controller stores a snapshot on `chat_plan.context_injection` and reuses it for explore, refine, and execute turns. Refine may optionally send a new snapshot to replace the stored one via the same **Select context** modal pattern used by the main composer.

## Console UX

- Chat cards show **one consolidated status badge** (for example `Exploring`, `Draft ready`, `Executed`) before the plan title instead of separate status/phase badges.
- Card actions place **View plan** and the icon-only **Execute plan** action on one full-width row.
- The detail modal uses the same title-row pattern (badge + title) and keeps the markdown body separate from actions with spacing equivalent to the main chat cards.
- Refinement is handled through an **inline composer** inside the modal with:
  - the plan refinement textarea
  - **Select context**
  - **Enhance prompt with AI**
  - an icon-only **Refine plan** submit action
- The footer keeps terminal actions only (for example **Cancel plan**, icon-only **Execute plan**) and **Open plan details**, which opens the plan on the plans page. The chat card has the same link as an icon button next to **View plan**.

## Plans page

The console page **Plans** (`/plans/:clientId?agentId=&openPlanId=`, sidebar between **Knowledge** and **Tasks**) lists every plan of one environment. It uses the same workspace picker as tickets, knowledge and tasks. Plans are agent specific, so one environment is always selected (filters drawer; the workspace's first environment by default).

- **Search** (server-side, debounced) matches the plan title, the original request and the plan body. The **State** filter narrows to plans that are _not executed (editable)_ or _executed or in progress (read-only)_. The table pages server-side (newest first).
- **Editing**: plans that never entered execution and are not being drafted (`ready`, `failed` or `cancelled`) are edited with the same markdown editor as knowledge pages and tickets (plus the title), saved explicitly with **Save** / **Discard changes**. The save is conditional on the version the user started from: if the agent refined the plan, another user saved, or execution started in between, it is refused (409) and the page offers **Load latest version**. Unsaved edits are never overwritten by live updates; a warning shows when the plan changed meanwhile.
- **Read-only**: from the moment a plan enters `executing` for the first time (`chat_plan.execution_started_at`) it stays read-only for good, retries of a failed execution included. The page shows the executed version as rendered markdown. While the agent explores or refines, the content is locked as well.
- **Refine with the agent**: ready plans can be refined from the page with the same `refineChatPlan` socket command as the chat modal (the stored context snapshot is reused). Unsaved edits must be saved or discarded first, because the agent refines the saved plan.
- **Activity**: each plan has an activity log (`chat_plan_activity`): created, draft by agent, refinement requested (with the instructions), edited (fields), execution started (marked when it ran an edited version), executed, failed, cancelled, retry requested. Each row records the actor (user e-mail, agent or system).
- **Open chat** jumps to the plan's chat session on the agent's chat page.

### Plans as context

Plans can be linked as context like tickets and knowledge pages (see [Agent Context MCP](../ai-agents/context-mcp.md#plans-as-context)):

- **Users**: the chat composer's and plan refine's **Select context** modal has a _Plan context (this environment)_ picker (title or SHA; a plan never links itself when refining). The plans page shows each plan's reference (`plan:<short sha>`, copy button). Linked plans travel as `contextInjection.planShas`; the controller resolves them (user's workspace access, chat's environment only) into `planContexts` / `planContextRefs`.
- **Agents**: `agenstra_context_search` / `_get` / `_request_access` accept `plan` / `plan:<sha>`, limited to the agent's own environment; `agenstra_content_plan_update` changes a plan that was not executed yet (asked in visible chats, opt-in for tasks, never for ticket automation).
- Plan responses carry `shas: { short, long }` (`chat_plan.long_sha`).

### Plans from initiative stories

**Plan** on a transferred story of an [initiative](./initiatives.md) (`POST /initiative-work-items/{id}/plan` with
`agentId`, `chatId`, optional `model` / `instructions`) creates a plan on that environment and chat. Its context snapshot
pre-grants the story ticket plus the initiative overview and accepted documents (`initiativeContexts` /
`initiativeContextRefs`), read-only like all plan context. Explore, refine and execute work as for every plan.

### Edited plans and execution

User edits replace `chat_plan.plan_markdown`, the single source the orchestrator reads. Execute and refine read the plan **after** their conditional status transition, and edits are only accepted in editable statuses. So an execution always runs exactly the latest saved version; an edit saved a moment before execution starts is included, and one arriving after is refused. Execution runs in the plan's **visible chat** (`chatId`, not persisted as a user message via `suppressUserMessage`) with the chat's normal interactive permissions. The hidden `-plan-{id}` session stays explore-only and is used for explore / refine turns only. The execute prompt states that the plan below is the final version and supersedes every earlier draft. When a user edited the plan, the execute and refine prompts also state explicitly that earlier drafts must not be reintroduced or acted on.

## Phases (high level)

1. **Create** Console emits `createChatPlan` with `chatId`, prompt, model, and context. Controller inserts a `chat_plan` row (`exploring` / `explore`), emits `chatPlanUpsert`, and starts the orchestrator.
2. **Explore** Hidden OpenCode session `-plan-{planId}` with platform agent `agenstra-plan` and explore-only session permission ruleset (deny edit/write/patch/bash). Live markdown/status updates via throttled `chatPlanUpsert`.
3. **Ready** Structured turn status reports `ready` with `planMarkdown` / `summary` (or best-effort text extraction). Card becomes executable.
4. **Refine** (optional) `refineChatPlan` continues the same hidden session; status moves through `refining` then back to `ready`.
5. **Execute** `executeChatPlan` prompts the **visible** chat with the plan body and stored context (normal interactive permissions). Plan status becomes `executed`.
6. **Cancel** `cancelChatPlan` or REST cancel stops active explore/refine.

At most one **active** plan (`exploring` / `refining`) is allowed per `(agentId, chatId)`.

## Unattended OpenCode sessions (explore-only)

Reserved resume suffix `-plan-{planId}`:

- Hidden / ephemeral — no `agent_messages` rows; not listed in session switcher
- Session-scoped permission override: allow read/glob/grep/(web explore); **deny** write/mutation tools (including bash)
- Runtime auto-replies residual permission asks: allow explore, **reject** write/unknown; not automation allow-all and not `unattendedAutomation`
- Platform-injected agent `agenstra-plan` and skill `agenstra-chat-plan` (config sync bump via `AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION`)

Interactive chat and execute paths keep normal worker permissions.

## Persistence and restore

Source of truth is the controller `chat_plan` table (not chat message history). After agent login, the controller unicasts recent plans via `chatPlanUpsert` with `hydrate: true` (capped similarly to automation hydrate). Live updates broadcast to room `client:{clientId}`. Frontend merges cards into the timeline only when `plan.chatId` matches the selected chat (unlike automation cards, which are primary-only).

## HTTP and realtime

- **REST** `GET /clients/{id}/agents/{agentId}/chats/{chatId}/plans`, `GET .../plans/{planId}`, `POST .../plans/{planId}/cancel` (OpenAPI operationIds `listChatPlans`, `getChatPlan`, `cancelChatPlan`)
- **REST (plans page)** `GET /clients/{id}/agents/{agentId}/plans?search=&state=editable|readonly&limit=&offset=` (`listAgentChatPlans`, returns `{ items, total }`), `PATCH .../plans/{planId}` with `{ planMarkdown?, summary?, expectedUpdatedAt }` (`updateChatPlan`; 409 when stale, being drafted or executed), `GET .../plans/{planId}/activity` (`listChatPlanActivity`). Plan responses carry `editable`, `executionStartedAt`, `lastEditedAt` and `lastEditedByUserId`.
- **WS (clients namespace, controller-handled)** `createChatPlan`, `refineChatPlan`, `executeChatPlan`, `cancelChatPlan`, `chatPlanUpsert`
- Statistics kinds: `chat_plan_turn`, `chat_plan_execute`

See [WebSocket communication](./websocket-communication.md), [Chat Interface](./chat-interface.md), and the agent-controller AsyncAPI / OpenAPI.

## Related documentation

- [Chat Interface](./chat-interface.md) Hidden `-plan-*` suffixes and chat-scoped cards
- [Ticket automation](./ticket-automation.md) Parallel durability / hydrate pattern (primary-only cards; allow-all sessions)
- [Agent configuration](./agent-configuration.md) Platform wire / OpenCode config sync
- [Usage statistics](./usage-statistics.md) Interaction kinds
- [Backend Agent Controller](../applications/backend-agent-controller.md)
- [Frontend Agent Console](../applications/frontend-agent-console.md)
