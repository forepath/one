import * as fs from 'fs';
import * as path from 'path';

import type { ProjectGraph } from '@nx/devkit';

import { KnowledgeEdge, KnowledgeNode, ProjectNodeAttrs, toolNodeId } from './schema';

const SKIP_TOOL_DIR_NAMES = new Set(['node_modules', 'dist', '.git', 'coverage', 'tmp']);

export interface DiscoverToolsResult {
  nodes: KnowledgeNode[];
}

/**
 * Emit `tool` nodes for non-Nx directories under `tools/` (e.g. `tools/ci`, `tools/docs`).
 * Nx projects under `tools/` are already typed as `tool` by {@link fromProjectGraph}.
 */
export function discoverToolDirectories(workspaceRoot: string, projectGraph: ProjectGraph): DiscoverToolsResult {
  const toolsRoot = path.join(workspaceRoot, 'tools');
  const nodes: KnowledgeNode[] = [];

  if (!fs.existsSync(toolsRoot)) {
    return { nodes };
  }

  const nxToolRoots = new Set<string>();
  for (const node of Object.values(projectGraph.nodes)) {
    const root = (node.data.root ?? '').replace(/\\/g, '/');
    if (root === 'tools' || root.startsWith('tools/')) {
      nxToolRoots.add(root);
    }
  }

  for (const entry of fs.readdirSync(toolsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_TOOL_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const relativeRoot = `tools/${entry.name}`;
    if (nxToolRoots.has(relativeRoot)) {
      continue;
    }

    const attrs: ProjectNodeAttrs = {
      name: entry.name,
      root: relativeRoot,
      tags: ['type:tool'],
      type: 'tool',
      targets: [],
    };

    nodes.push({
      id: toolNodeId(entry.name),
      type: 'tool',
      attrs,
    });
  }

  return { nodes };
}
