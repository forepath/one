#!/usr/bin/env node
/**
 * CLI for knowledge-graph recipes (same logic as the MCP server).
 *
 * Usage:
 *   node dist/tools/graph/src/query-cli.js r1 <project>
 *   node dist/tools/graph/src/query-cli.js docs <project>
 *   node dist/tools/graph/src/query-cli.js endpoint --method POST --path /auth/register
 *   node dist/tools/graph/src/query-cli.js search <keyword>
 *   node dist/tools/graph/src/query-cli.js impact [--base main] [--paths file1,file2]
 *   node dist/tools/graph/src/query-cli.js mentions <project> [--scope workspace|neighbors]
 */
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

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage(): never {
  console.error(`Usage:
  query-cli r1 <project>
  query-cli docs <project> [--no-endpoints]
  query-cli endpoint [--id ID] [--method M --path /p] [--operationId ID] [--channel NAME]
  query-cli search <keyword>
  query-cli impact [--base <ref>] [--paths a,b] [--no-uncommitted]
  query-cli mentions <project> [--scope workspace|neighbors]`);
  process.exit(2);
}

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Record<string, string | boolean> } {
  const [cmd, ...rest] = argv;
  if (!cmd) usage();
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--no-endpoints' || arg === '--no-uncommitted') {
      flags[arg.slice(2)] = true;
      continue;
    }
    if (arg.startsWith('--') && arg.includes('=')) {
      const [k, v] = arg.slice(2).split('=');
      flags[k] = v;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
      continue;
    }
    positional.push(arg);
  }
  return { cmd, positional, flags };
}

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv.slice(2));
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const graphPath = typeof flags.graph === 'string' ? flags.graph : undefined;
  const index = KnowledgeGraphIndex.fromFile(resolveGraphJsonPath(workspaceRoot, graphPath));

  switch (cmd) {
    case 'r1': {
      if (!positional[0]) usage();
      printJson(recipeR1(index, positional[0]));
      return;
    }
    case 'docs': {
      if (!positional[0]) usage();
      printJson(recipeR2(index, positional[0], { includeEndpoints: !flags['no-endpoints'] }));
      return;
    }
    case 'endpoint': {
      printJson(
        recipeR3(index, {
          id: typeof flags.id === 'string' ? flags.id : undefined,
          method: typeof flags.method === 'string' ? flags.method : undefined,
          path: typeof flags.path === 'string' ? flags.path : undefined,
          operationId: typeof flags.operationId === 'string' ? flags.operationId : undefined,
          channel: typeof flags.channel === 'string' ? flags.channel : undefined,
        }),
      );
      return;
    }
    case 'search': {
      if (!positional[0]) usage();
      printJson(recipeR5(index, positional[0]));
      return;
    }
    case 'impact': {
      const paths =
        typeof flags.paths === 'string'
          ? flags.paths
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined;
      const collected = collectImpactPaths({
        workspaceRoot,
        paths,
        baseRef: typeof flags.base === 'string' ? flags.base : undefined,
        includeUncommitted: !flags['no-uncommitted'],
      });
      printJson(computeImpact(index, collected.paths, { baseRef: collected.baseRef }));
      return;
    }
    case 'mentions': {
      if (!positional[0]) usage();
      const scope = flags.scope === 'neighbors' ? 'neighbors' : 'workspace';
      printJson(findMentions(index, positional[0], { workspaceRoot, scope }));
      return;
    }
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[forepath/graph-query] Failed: ${message}`);
  process.exit(1);
});
