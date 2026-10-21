/**
 * Agenstra context MCP server (stdio). Shipped in the worker image and started by OpenCode as the
 * platform-managed `agenstra` MCP server. Prompts only carry hints plus a context ticket; this server
 * reads the referenced tickets / knowledge from the agent-manager on demand, lets the agent manage its
 * own recurring tasks and hand tasks over to other agents of its workspace.
 *
 * Stdout is reserved for MCP JSON-RPC — diagnostics go to stderr only.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { ContextApiClient, readContextApiConfig } from './lib/context-api.client';
import { callContextTool, CONTEXT_TOOL_DEFINITIONS } from './lib/context-tools';
import { callHandoffTool, HANDOFF_TOOL_DEFINITIONS, isHandoffToolName } from './lib/handoff-tools';
import { waitForContextApi } from './lib/startup';
import { callTaskTool, isTaskToolName, TASK_TOOL_DEFINITIONS } from './lib/task-tools';

async function main(): Promise<void> {
  const client = new ContextApiClient(readContextApiConfig());

  // Fail fast when the manager is unreachable or the token is wrong: OpenCode then reports the server as
  // failed and the agent-manager falls back to inlining context into prompts.
  await waitForContextApi(client);

  const server = new Server({ name: 'agenstra', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...CONTEXT_TOOL_DEFINITIONS, ...TASK_TOOL_DEFINITIONS, ...HANDOFF_TOOL_DEFINITIONS],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (isTaskToolName(name)) {
      return callTaskTool(client, name, args);
    }

    if (isHandoffToolName(name)) {
      return callHandoffTool(client, name, args);
    }

    return callContextTool(client, name, args);
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`[agenstra-context-mcp] ${message}\n`);
  process.exit(1);
});
