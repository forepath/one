import {
  AGENSTRA_GRAPH_MCP_TOOL_NAMES,
  AGENSTRA_WORKSPACE_MOUNT_ROOT,
  AGENT_GRAPH_EDGE_TYPES,
  AGENT_GRAPH_LAYERS,
  AGENT_GRAPH_LIMITS,
  AGENT_GRAPH_NODE_TYPES,
} from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError, type GraphQuery } from './context-api.client';
import type { ContextToolDefinition, ContextToolResult } from './context-tools';

/**
 * Environment graph tools (`agenstra_graph_*`): structure (code / docs / instructions), paths and prompt references
 * of the own environment and of other environments visible below `/opt/workspace`. Read-only.
 */

const ENVIRONMENT_PROPERTY = {
  type: 'string',
  description:
    'Environment to inspect: omit for your own; otherwise an environment id or mount id from graph_environments, the ' +
    `name of a workspace peer, or a path below ${AGENSTRA_WORKSPACE_MOUNT_ROOT}/<mount id>.`,
};
const LAYER_PROPERTY = {
  type: 'string',
  enum: ['all', ...AGENT_GRAPH_LAYERS],
  description:
    'code (default): modules, files, symbols, imports, packages, docs, concepts, instruction files. paths: directory ' +
    'tree with sizes. references: prompts and the context they had (attached / available) or touched (used / ' +
    'modified). all: every layer merged (a file links its imports, its directory and the prompts that touched it).',
};
const NODE_ID_PROPERTY = {
  type: 'string',
  maxLength: AGENT_GRAPH_LIMITS.idMaxLength,
  description:
    'Node id from another graph tool (e.g. "file:src/app.ts", "symbol:src/app.ts#App", "module:packages/api").',
};

export const GRAPH_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.environments,
    description:
      'List the environments whose graphs you can read: your own and every environment mounted read-only below ' +
      `${AGENSTRA_WORKSPACE_MOUNT_ROOT} (names only for your workspace; others are identified by mount id). Shows ` +
      'graph status, file counts and where each environment is mounted.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.overview,
    description:
      'Start here: structural overview of an environment — modules, most connected files / symbols (hubs), clusters, ' +
      'instruction files (AGENTS.md, rules, skills) and the latest prompts with their reference counts.',
    inputSchema: { type: 'object', properties: { environment: ENVIRONMENT_PROPERTY }, additionalProperties: false },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.search,
    description:
      'Find nodes by name or path (files, symbols, modules, packages, doc sections, prompts, tickets ...). Use ' +
      'environment "*" to search every reachable environment at once. Results include absolute paths.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: AGENT_GRAPH_LIMITS.queryMaxLength, description: 'Name or path fragment.' },
        environment: ENVIRONMENT_PROPERTY,
        layer: LAYER_PROPERTY,
        types: {
          type: 'array',
          items: { type: 'string', enum: [...AGENT_GRAPH_NODE_TYPES] },
          description: 'Only these node types.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: AGENT_GRAPH_LIMITS.maxSearchResults,
          description: 'Default 20.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.node,
    description:
      'One node with its incoming and outgoing relations (imports, importers, contained / defined elements, docs ...).',
    inputSchema: {
      type: 'object',
      properties: { id: NODE_ID_PROPERTY, environment: ENVIRONMENT_PROPERTY, layer: LAYER_PROPERTY },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.neighbors,
    description:
      'Neighbourhood of a node (1-3 hops), optionally restricted to edge types, e.g. ["imports"] for the dependency fan.',
    inputSchema: {
      type: 'object',
      properties: {
        id: NODE_ID_PROPERTY,
        environment: ENVIRONMENT_PROPERTY,
        layer: LAYER_PROPERTY,
        depth: { type: 'integer', minimum: 1, maximum: AGENT_GRAPH_LIMITS.maxNeighborDepth, description: 'Default 1.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: AGENT_GRAPH_LIMITS.maxNeighborNodes,
          description: 'Max nodes (default 60).',
        },
        edgeTypes: { type: 'array', items: { type: 'string', enum: [...AGENT_GRAPH_EDGE_TYPES] } },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.path,
    description: 'Shortest connection between two nodes (how a file reaches another, which doc covers a module ...).',
    inputSchema: {
      type: 'object',
      properties: {
        from: NODE_ID_PROPERTY,
        to: NODE_ID_PROPERTY,
        environment: ENVIRONMENT_PROPERTY,
        layer: LAYER_PROPERTY,
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.file,
    description:
      'Everything known about one file: symbols, imports, importers, documenting docs and the prompts that read or ' +
      `changed it. Accepts an absolute path (your working directory or ${AGENSTRA_WORKSPACE_MOUNT_ROOT}/<mount id>/...) ` +
      'or a path relative to the environment.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: AGENT_GRAPH_LIMITS.idMaxLength, description: 'File path.' },
        environment: ENVIRONMENT_PROPERTY,
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.references,
    description:
      'Prompt reference history: which context each prompt had attached, what was implicitly available (instructions, ' +
      'skills, MCP servers) and which files / tickets / pages it used or modified. Pass promptId for the full list of ' +
      'one prompt. Only for your own environment and workspace peers.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: ENVIRONMENT_PROPERTY,
        promptId: { type: 'string', maxLength: 128, description: 'Prompt id from a previous graph_references call.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Prompts to list (default 20).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_GRAPH_MCP_TOOL_NAMES.refresh,
    description:
      'Rebuild your own environment graph now (it also rebuilds automatically after file changes and finished turns).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const GRAPH_TOOL_NAMES = new Set<string>(Object.values(AGENSTRA_GRAPH_MCP_TOOL_NAMES));

export function isGraphToolName(name: string): boolean {
  return GRAPH_TOOL_NAMES.has(name);
}

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

/** Compact JSON: graph answers can be large and are read by the model, not by humans. */
function json(value: unknown): ContextToolResult {
  return text(JSON.stringify(value));
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function intArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];

  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function listArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];

  if (!Array.isArray(value)) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  const list = value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim());

  return list.length > 0 ? list.join(',') : undefined;
}

/** Dispatch one graph tool call. Errors become `isError` results (never thrown to the transport). */
export async function callGraphTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const environment = stringArg(args, 'environment');
  const layer = stringArg(args, 'layer');
  const get = (path: string, query: GraphQuery) => client.graph<unknown>(path, query);

  try {
    switch (name) {
      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.environments:
        return json(await get('environments', {}));
      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.overview:
        return json(await get('overview', { environment }));

      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.search: {
        const query = stringArg(args, 'query');

        if (!query) {
          return text('Provide "query".', true);
        }

        return json(
          await get('search', {
            query,
            environment,
            layer,
            types: listArg(args, 'types'),
            limit: intArg(args, 'limit'),
          }),
        );
      }

      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.node: {
        const id = stringArg(args, 'id');

        return id
          ? json(await get('nodes', { id, environment, layer }))
          : text('Provide "id" (from graph_search).', true);
      }

      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.neighbors: {
        const id = stringArg(args, 'id');

        if (!id) {
          return text('Provide "id" (from graph_search).', true);
        }

        return json(
          await get('neighbors', {
            id,
            environment,
            layer,
            depth: intArg(args, 'depth'),
            limit: intArg(args, 'limit'),
            edgeTypes: listArg(args, 'edgeTypes'),
          }),
        );
      }

      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.path: {
        const from = stringArg(args, 'from');
        const to = stringArg(args, 'to');

        return from && to
          ? json(await get('path', { from, to, environment, layer }))
          : text('Provide "from" and "to".', true);
      }

      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.file: {
        const path = stringArg(args, 'path');

        return path ? json(await get('file', { path, environment })) : text('Provide "path".', true);
      }

      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.references:
        return json(
          await get('references', { environment, promptId: stringArg(args, 'promptId'), limit: intArg(args, 'limit') }),
        );
      case AGENSTRA_GRAPH_MCP_TOOL_NAMES.refresh:
        return json(await client.refreshGraph());
      default:
        return text(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message = error instanceof ContextApiError || error instanceof Error ? error.message : 'Graph request failed';

    return text(message, true);
  }
}
