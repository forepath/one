# agenstra-shared-util-opencode-mcp-servers

Shared types and pure helpers for OpenCode MCP server catalogs sourced from the
official [MCP Registry](https://registry.modelcontextprotocol.io/docs).

The live catalog is stored in Postgres (`opencode_mcp_servers`) and exposed via
`GET /opencode/mcp-servers` on the agent controller. Refresh runs through BullMQ
(`opencode-mcp-servers.refresh`) — there is no committed snapshot.

## Exports

- `OpencodeBuiltinMcpServer` — registry server metadata (name, title, packages, remotes, …)
- `OpencodeMcpServerSeed` — seeded `mcp.servers` overlay (`secretEnv` / `secretHeaders` lists)
- `getBuiltinMcpServer` / `unusedBuiltinMcpServers` / `builtinMcpServerLabel`
- `seedMcpServerFromCatalog` / `selectPreferredPackage` / `mcpServerConfigKey` / `mcpOAuthClientSecretKey`

## Building / tests

```bash
nx build agenstra-shared-util-opencode-mcp-servers
nx test agenstra-shared-util-opencode-mcp-servers
```
