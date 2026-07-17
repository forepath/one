#!/usr/bin/env node
import * as path from 'path';

import { createProjectGraphAsync, workspaceRoot } from '@nx/devkit';

import { buildKnowledgeGraph, writeKnowledgeGraphArtifacts } from './lib/build-knowledge-graph';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let outDir = path.join(workspaceRoot, 'graph');
  let skipHtml = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--outDir' && args[i + 1]) {
      outDir = path.resolve(workspaceRoot, args[++i]);
    } else if (arg.startsWith('--outDir=')) {
      outDir = path.resolve(workspaceRoot, arg.slice('--outDir='.length));
    } else if (arg === '--skipHtml') {
      skipHtml = true;
    }
  }

  const projectGraph = await createProjectGraphAsync({ exitOnError: true });
  const graph = buildKnowledgeGraph({
    projectGraph,
    workspaceRoot,
  });
  const { jsonPath, htmlPath } = writeKnowledgeGraphArtifacts({
    graph,
    outDir,
    skipHtml,
  });

  console.log(`[forepath/graph] Wrote ${jsonPath}`);
  if (htmlPath) {
    console.log(`[forepath/graph] Wrote ${htmlPath}`);
  }
  console.log(`[forepath/graph] ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[forepath/graph] Failed: ${message}`);
  process.exit(1);
});
