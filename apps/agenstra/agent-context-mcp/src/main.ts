/**
 * Agenstra context MCP server (stdio). Shipped in the worker image and started by OpenCode as the
 * platform-managed `agenstra` MCP server. Prompts only carry hints plus a context ticket; this server
 * reads the referenced tickets / knowledge from the agent-manager on demand, changes them (approved by the user or
 * allowed for the run), lets the agent manage its own recurring tasks and hand tasks over to other agents of its
 * workspace, explore structural graphs of its own and other mounted environments, follow / start the CI/CD
 * deployment workflows available to its environment (run actions decided like content changes) and propose
 * deployment workflows for itself (pending until a workspace admin approves them).
 *
 * Stdout is reserved for MCP JSON-RPC — diagnostics go to stderr only.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { callContentTool, CONTENT_TOOL_DEFINITIONS, isContentToolName } from './lib/content-tools';
import { ContextApiClient, readContextApiConfig } from './lib/context-api.client';
import { callContextTool, CONTEXT_TOOL_DEFINITIONS } from './lib/context-tools';
import { callDeploymentTool, DEPLOYMENT_TOOL_DEFINITIONS, isDeploymentToolName } from './lib/deployment-tools';
import { callGraphTool, GRAPH_TOOL_DEFINITIONS, isGraphToolName } from './lib/graph-tools';
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
    tools: [
      ...CONTEXT_TOOL_DEFINITIONS,
      ...CONTENT_TOOL_DEFINITIONS,
      ...TASK_TOOL_DEFINITIONS,
      ...HANDOFF_TOOL_DEFINITIONS,
      ...GRAPH_TOOL_DEFINITIONS,
      ...DEPLOYMENT_TOOL_DEFINITIONS,
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (isContentToolName(name)) {
      return callContentTool(client, name, args);
    }

    if (isTaskToolName(name)) {
      return callTaskTool(client, name, args);
    }

    if (isHandoffToolName(name)) {
      return callHandoffTool(client, name, args);
    }

    if (isGraphToolName(name)) {
      return callGraphTool(client, name, args);
    }

    if (isDeploymentToolName(name)) {
      return callDeploymentTool(client, name, args);
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
