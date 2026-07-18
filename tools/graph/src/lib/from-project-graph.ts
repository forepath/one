import type { ProjectGraph } from '@nx/devkit';

import { KnowledgeEdge, KnowledgeNode, ProjectNodeKind, isToolsProjectRoot, projectNodeId } from './schema';

export interface ProjectGraphSlice {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

function classifyProjectKind(root: string, projectType: string | undefined): ProjectNodeKind {
  if (isToolsProjectRoot(root)) {
    return 'tool';
  }
  return projectType === 'application' ? 'app' : 'lib';
}

/**
 * Map an Nx ProjectGraph into project nodes and depends_on edges.
 * External npm nodes are ignored here (see link-packages for app-attributed packages).
 * Projects under `tools/` are typed as `tool`.
 */
export function fromProjectGraph(projectGraph: ProjectGraph): ProjectGraphSlice {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const knownProjects = new Set(Object.keys(projectGraph.nodes));

  for (const [name, node] of Object.entries(projectGraph.nodes)) {
    const root = node.data.root ?? '';
    const projectKind = classifyProjectKind(root, node.data.projectType);
    const targets = node.data.targets ? Object.keys(node.data.targets) : [];
    const tags = Array.isArray(node.data.tags) ? [...node.data.tags] : [];

    nodes.push({
      id: projectNodeId(name),
      type: projectKind,
      attrs: {
        name,
        root,
        tags,
        type: projectKind,
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
