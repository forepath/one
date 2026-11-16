# feature-agent-harness

NestJS integration of the [agent harness](../../shared/util-agent-harness/README.md): connects a backend to one Agenstra agent through its OpenAI-compatible API, registers `@AgentTool()` / `@AgentContext()` provider methods, runs turns and sessions, and relays turns to the application's frontend as Server-Sent Events.

See `docs/agenstra/features/agent-harness.md`.
