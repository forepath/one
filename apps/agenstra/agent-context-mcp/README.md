# agenstra-agent-context-mcp

Platform-managed MCP server (stdio) shipped in the worker image (`ghcr.io/forepath/agenstra-manager-worker`) at
`/opt/agenstra/mcp/agenstra-context-mcp.cjs`. OpenCode starts it as the `agenstra` MCP server; the agent-manager
registers it during OpenCode config sync.

Prompts only carry hints and a context ticket; this server reads tickets / knowledge from the agent-manager context API
(`/api/agent-context/*`). See [Agent Context MCP](../../../docs/agenstra/ai-agents/context-mcp.md).

It also serves `tasks_*` tools (`agenstra_tasks_*` in OpenCode) for the agent's own recurring tasks
(`/api/agent-context/tasks`). See [Agent tasks](../../../docs/agenstra/features/agent-tasks.md).

`handoff_*` tools (`agenstra_handoff_*`) hand tasks over to other agents of the same workspace
(`/api/agent-context/handoffs`). See [Agent handoffs](../../../docs/agenstra/features/agent-handoffs.md).

## Environment (set by the agent-manager)

| Variable                       | Purpose                                           |
| ------------------------------ | ------------------------------------------------- |
| `AGENSTRA_CONTEXT_API_URL`     | Manager base URL incl. `/api`                     |
| `AGENSTRA_CONTEXT_AGENT_ID`    | Agent id (`x-agenstra-agent-id`)                  |
| `AGENSTRA_CONTEXT_AGENT_TOKEN` | Per-agent context token (`Authorization: Bearer`) |

The server probes `GET /agent-context/health` on start and exits non-zero when the manager is unreachable or the token
is rejected; the manager then keeps inlining context into prompts.

## Targets

```bash
npx nx run agenstra-agent-context-mcp:build   # esbuild bundle → dist/apps/agenstra/agent-context-mcp/agenstra-context-mcp.cjs
npx nx test agenstra-agent-context-mcp
npx nx run agenstra-backend-agent-manager:worker-container-image   # copies the bundle into the worker image
```
