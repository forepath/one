import type { ProjectGraph } from '@nx/devkit';
import { createPackageJson } from '@nx/js';

import { KnowledgeEdge, KnowledgeNode, PackageNodeAttrs, packageNodeId, projectNodeId } from './schema';

export interface LinkPackagesResult {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface LinkPackagesOptions {
  projectGraph: ProjectGraph;
  workspaceRoot: string;
  /**
   * When set, used instead of `@nx/js` createPackageJson (tests).
   * Return production dependency map: name → version range.
   */
  resolveProductionDeps?: (projectName: string) => Record<string, string>;
}

/**
 * Attribute production npm packages to Nx **applications** using the same
 * Nx `createPackageJson` / generatePackageJson mechanism as SBOM builds.
 * Shared libs are rolled into consuming apps — packages are not emitted for libs alone.
 */
export function linkPackages(options: LinkPackagesOptions): LinkPackagesResult {
  const nodesById = new Map<string, KnowledgeNode>();
  const edges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();

  const resolveDeps =
    options.resolveProductionDeps ??
    ((projectName: string): Record<string, string> => {
      const pkg = createPackageJson(projectName, options.projectGraph, {
        root: options.workspaceRoot,
        isProduction: true,
      });
      return (pkg.dependencies ?? {}) as Record<string, string>;
    });

  for (const [name, node] of Object.entries(options.projectGraph.nodes)) {
    if (node.data.projectType !== 'application') {
      continue;
    }

    let deps: Record<string, string>;
    try {
      deps = resolveDeps(name);
    } catch {
      continue;
    }

    const projectId = projectNodeId(name);
    for (const [packageName, version] of Object.entries(deps)) {
      if (!packageName || packageName.startsWith('@forepath/')) {
        // Workspace packages are Nx projects, not external npm package nodes.
        continue;
      }

      const id = packageNodeId(packageName);
      if (!nodesById.has(id)) {
        const attrs: PackageNodeAttrs = { name: packageName };
        if (typeof version === 'string' && version.length > 0) {
          attrs.version = version;
        }
        nodesById.set(id, { id, type: 'package', attrs });
      } else if (typeof version === 'string' && version.length > 0) {
        const existing = nodesById.get(id)!;
        const attrs = existing.attrs as PackageNodeAttrs;
        if (!attrs.version) {
          attrs.version = version;
        }
      }

      const edgeKey = `${projectId}->${id}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({ from: projectId, to: id, type: 'depends_on' });
      }
    }
  }

  return { nodes: [...nodesById.values()], edges };
}
