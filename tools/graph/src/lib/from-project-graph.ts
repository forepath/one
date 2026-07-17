import type { ProjectGraph } from '@nx/devkit';

import { KnowledgeEdge, KnowledgeNode, projectNodeId, ProjectNodeKind } from './schema';

export interface ProjectGraphSlice {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

/**
 * Map an Nx ProjectGraph into project nodes and depends_on edges.
 * External npm nodes are ignored.
 */
export function fromProjectGraph(projectGraph: ProjectGraph): ProjectGraphSlice {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const knownProjects = new Set(Object.keys(projectGraph.nodes));

  for (const [name, node] of Object.entries(projectGraph.nodes)) {
    const projectType = node.data.projectType === 'application' ? 'app' : 'lib';
    const targets = node.data.targets ? Object.keys(node.data.targets) : [];
    const tags = Array.isArray(node.data.tags) ? [...node.data.tags] : [];

    nodes.push({
      id: projectNodeId(name),
      type: projectType as ProjectNodeKind,
      attrs: {
        name,
        root: node.data.root,
        tags,
        type: projectType as ProjectNodeKind,
        targets,
      },
    });
  }

  for (const [source, deps] of Object.entries(projectGraph.dependencies ?? {})) {
    if (!knownProjects.has(source)) {
      continue;
    }

    for (const dep of deps) {
      const target = dep.target;
      if (!knownProjects.has(target)) {
        continue;
      }
      if (target.startsWith('npm:')) {
        continue;
      }

      edges.push({
        from: projectNodeId(source),
        to: projectNodeId(target),
        type: 'depends_on',
      });
    }
  }

  return { nodes, edges };
}
