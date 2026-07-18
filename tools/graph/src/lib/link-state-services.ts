import { FileNodeAttrs, KnowledgeEdge, KnowledgeNode } from './schema';

/**
 * Link NgRx `state` nodes to matching `service` nodes in the same project.
 * Match is exact: `<sliceName>.service.ts`.
 */
export function linkStateServices(nodes: KnowledgeNode[]): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const servicesByProject = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    if (node.type !== 'service') {
      continue;
    }
    const attrs = node.attrs as FileNodeAttrs;
    const projectName = attrs.projectName;
    if (!projectName) {
      continue;
    }
    const list = servicesByProject.get(projectName) ?? [];
    list.push(node);
    servicesByProject.set(projectName, list);
  }

  for (const node of nodes) {
    if (node.type !== 'state') {
      continue;
    }
    const attrs = node.attrs as FileNodeAttrs;
    const sliceName = attrs.sliceName;
    const projectName = attrs.projectName;
    if (!sliceName || !projectName) {
      continue;
    }

    const expectedBase = `${sliceName}.service.ts`.toLowerCase();
    const services = servicesByProject.get(projectName) ?? [];
    for (const service of services) {
      const serviceAttrs = service.attrs as FileNodeAttrs;
      const base = serviceAttrs.path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
      if (base !== expectedBase) {
        continue;
      }
      const key = `${node.id}->${service.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ from: node.id, to: service.id, type: 'contains' });
    }
  }

  return edges;
}
