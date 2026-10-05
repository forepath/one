# Chat plan mode

Operators can turn the current chat composer prompt (plus selected context) into an **explore-then-plan** workflow. A hidden OpenCode session investigates the repository with **explore-only** permissions, a chat-scoped timeline card shows live status and plan markdown, a detail modal supports refine, and **Execute plan** injects the plan into the same visible chat.

This is an Agenstra productivity feature built on OpenCode (not a native OpenCode “plan mode” product API). It mirrors ticket-automation durability and hydrate patterns, but is user-triggered and chat-session scoped.

## Prerequisites

- Authenticated console user with access to the client and `agents:chats` scope
- Selected agent environment with a working OpenCode worker and up-to-date config sync (platform plan agent/skill injected)
- Non-empty composer prompt and a selected visible chat session (`primary` or `user`)

## Context injection

Plan creation uses the **same composer context** as Send (`ContextInjectionPayload`): workspace, related environments, ticket SHAs, knowledge SHAs, and auto-enrichment. The controller stores a snapshot on `chat_plan.context_injection` and reuses it for explore, refine, and execute turns. Refine may optionally send a new snapshot to replace the stored one.

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
