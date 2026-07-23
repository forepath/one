#!/usr/bin/env node
/**
 * MCP server for knowledge-graph recipes (stdio).
 * Prefer these tools over loading graph/graph.json into model context.
 */
import { createRequire } from 'module';
import * as path from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  KnowledgeGraphIndex,
  collectImpactPaths,
  computeImpact,
  findMentions,
  recipeR1,
  recipeR2,
  recipeR3,
  recipeR5,
  resolveGraphJsonPath,
  resolveWorkspaceRoot,
} from './lib/query';

/**
 * MCP SDK 1.18 validates tool args with Zod v3 (`_parse`). The workspace often
 * hoists Zod v4 at the root, so load the SDK's nested Zod v3 explicitly.
 */
type ZodType = {
  optional: () => ZodType;
  describe: (text: string) => ZodType;
  int: () => ZodType;
  positive: () => ZodType;
  max: (n: number) => ZodType;
};
type ZodModule = {
  string: () => ZodType;
  boolean: () => ZodType;
  number: () => ZodType;
  array: (schema: unknown) => ZodType;
  enum: (values: [string, ...string[]]) => ZodType;
};

function loadZodV3(): ZodModule {
  const require = createRequire(__filename);
  // Prefer Zod's v3 compatibility entry (works when Zod v4 is hoisted).
  try {
    const mod = require('zod/v3') as ZodModule;
    if (
      typeof (mod as { string?: () => { _parse?: unknown } }).string?.()._parse === 'function' ||
      typeof mod.string === 'function'
    ) {
      const probe = mod.string() as { _parse?: unknown };
      if (typeof probe._parse === 'function') {
        return mod;
      }
    }
  } catch {
    // continue
  }

  try {
    const sdkPkgJson = require.resolve('@modelcontextprotocol/sdk/package.json');
    let dir = path.dirname(sdkPkgJson);
    for (let i = 0; i < 6; i++) {
      try {
        const zodPath = require.resolve('zod', { paths: [dir] });
        const mod = require(zodPath) as ZodModule;
        const probe = mod.string() as { _parse?: unknown };
        if (typeof probe._parse === 'function') {
          return mod;
        }
      } catch {
        // keep walking
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // continue
  }

  throw new Error('Unable to load Zod v3 for MCP tool schemas. Install zod@3 or ensure zod/v3 is resolvable.');
}

const z = loadZodV3();

function loadIndex(graphPath?: string): KnowledgeGraphIndex {
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const jsonPath = resolveGraphJsonPath(workspaceRoot, graphPath);
  return KnowledgeGraphIndex.fromFile(jsonPath);
}

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

const server = new McpServer({
  name: 'knowledge-graph',
  version: '1.0.0',
});

server.tool(
  'graph_r1',
  'Recipe R1: blast radius for an Nx project (deps, contains by type, endpoints/channels, docs, injects/provides). Prefer over grepping graph.json.',
  { project: z.string().describe('Nx project name or project:<name> id') },
  async ({ project }: { project: string }) => {
    try {
      return textResult(recipeR1(loadIndex(), project));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  'graph_docs',
  'Recipe R2: doc concepts and docPaths that document a project (and optionally its endpoints/channels).',
  {
    project: z.string().describe('Nx project name or project:<name> id'),
    includeEndpoints: z.boolean().optional().describe('Include endpoint/channel-linked docs (default true)'),
  },
  async ({ project, includeEndpoints }: { project: string; includeEndpoints?: boolean }) => {
    try {
      return textResult(recipeR2(loadIndex(), project, { includeEndpoints }));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  'graph_endpoint',
  'Recipe R3: owners, implementers, callers, and docs for one HTTP endpoint or AsyncAPI channel.',
  {
    id: z.string().optional().describe('Full node id, e.g. api:HTTP:POST:/auth/register'),
    method: z.string().optional().describe('HTTP method'),
    path: z.string().optional().describe('HTTP path starting with /'),
    operationId: z.string().optional(),
    channel: z.string().optional().describe('AsyncAPI channel name or api:channel:… id'),
  },
  async (args: { id?: string; method?: string; path?: string; operationId?: string; channel?: string }) => {
    try {
      return textResult(recipeR3(loadIndex(), args));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  'graph_search',
  'Recipe R5: keyword search across graph node ids and attributes (typed hits, not raw repo files).',
  {
    keyword: z.string(),
    limit: z.number().int().positive().max(200).optional(),
  },
  async ({ keyword, limit }: { keyword: string; limit?: number }) => {
    try {
      return textResult(recipeR5(loadIndex(), keyword, { limit }));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  'graph_impact',
  'Diff → blast radius: map changed paths (explicit and/or git) to owning projects and run R1 for each.',
  {
    paths: z.array(z.string()).optional().describe('Workspace-relative paths'),
    baseRef: z.string().optional().describe('Git base ref for baseRef...HEAD (e.g. main, origin/main)'),
    includeUncommitted: z
      .boolean()
      .optional()
      .describe('When baseRef is omitted, include unstaged/staged/untracked (default true)'),
  },
  async ({
    paths,
    baseRef,
    includeUncommitted,
  }: {
    paths?: string[];
    baseRef?: string;
    includeUncommitted?: boolean;
  }) => {
    try {
      const workspaceRoot = resolveWorkspaceRoot(process.cwd());
      const index = loadIndex();
      const collected = collectImpactPaths({
        workspaceRoot,
        paths,
        baseRef,
        includeUncommitted,
      });
      return textResult(computeImpact(index, collected.paths, { baseRef: collected.baseRef }));
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.tool(
  'graph_mentions',
  'Soft references: textual mentions of a project outside depends_on (closes mentions-vs-declared-deps hole). Use after graph_r1 when copy-paste/string consumers matter.',
  {
    project: z.string(),
    scope: z.enum(['workspace', 'neighbors']).optional().describe('Search scope (default workspace)'),
    maxFiles: z.number().int().positive().max(200).optional(),
  },
  async ({ project, scope, maxFiles }: { project: string; scope?: 'workspace' | 'neighbors'; maxFiles?: number }) => {
    try {
      const workspaceRoot = resolveWorkspaceRoot(process.cwd());
      return textResult(
        findMentions(loadIndex(), project, {
          workspaceRoot,
          scope,
          maxFiles,
        }),
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

const transport = new StdioServerTransport();

(async () => {
  await server.connect(transport);
})().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[forepath/graph-mcp] Failed: ${message}`);
  process.exit(1);
});
