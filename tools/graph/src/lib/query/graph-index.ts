import * as fs from 'fs';
import * as path from 'path';

import {
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNode,
  ProjectNodeAttrs,
  isNxProjectNodeType,
  projectNodeId,
} from '../schema';

export interface NodeSummary {
  id: string;
  type: string;
  label: string;
  path?: string;
  root?: string;
  name?: string;
  docPath?: string;
  operationId?: string;
  method?: string;
  pathOrChannel?: string;
}

/**
 * Indexed view of graph/graph.json for recipe queries.
 */
export class KnowledgeGraphIndex {
  readonly graph: KnowledgeGraph;
  readonly nodeById: Map<string, KnowledgeNode>;
  readonly out: Map<string, KnowledgeEdge[]>;
  readonly inn: Map<string, KnowledgeEdge[]>;
  readonly projectNodes: KnowledgeNode[];
  private readonly projectsByRootDesc: Array<{ root: string; node: KnowledgeNode }>;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
    this.nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    this.out = new Map();
    this.inn = new Map();

    for (const edge of graph.edges) {
      if (!this.out.has(edge.from)) this.out.set(edge.from, []);
      if (!this.inn.has(edge.to)) this.inn.set(edge.to, []);
      this.out.get(edge.from)!.push(edge);
      this.inn.get(edge.to)!.push(edge);
    }

    this.projectNodes = graph.nodes.filter((n) => isNxProjectNodeType(n.type));
    this.projectsByRootDesc = this.projectNodes
      .map((node) => {
        const root = String((node.attrs as ProjectNodeAttrs).root ?? '')
          .replace(/\\/g, '/')
          .replace(/\/$/, '');
        return { root, node };
      })
      .filter((p) => p.root.length > 0)
      .sort((a, b) => b.root.length - a.root.length);
  }

  static fromFile(graphJsonPath: string): KnowledgeGraphIndex {
    const raw = fs.readFileSync(graphJsonPath, 'utf8');
    const graph = JSON.parse(raw) as KnowledgeGraph;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      throw new Error(`Invalid knowledge graph at ${graphJsonPath}`);
    }
    return new KnowledgeGraphIndex(graph);
  }

  summarize(node: KnowledgeNode): NodeSummary {
    const attrs = node.attrs as unknown as Record<string, unknown>;
    const label =
      (attrs.name as string) ||
      (attrs.title as string) ||
      (attrs.path as string) ||
      (attrs.pathOrChannel as string) ||
      (attrs.operationId as string) ||
      (attrs.templateName as string) ||
      (attrs.eventName as string) ||
      (attrs.sliceName as string) ||
      node.id;

    return {
      id: node.id,
      type: node.type,
      label,
      path: typeof attrs.path === 'string' ? attrs.path : undefined,
      root: typeof attrs.root === 'string' ? attrs.root : undefined,
      name: typeof attrs.name === 'string' ? attrs.name : undefined,
      docPath: typeof attrs.docPath === 'string' ? attrs.docPath : undefined,
      operationId: typeof attrs.operationId === 'string' ? attrs.operationId : undefined,
      method: typeof attrs.method === 'string' ? attrs.method : undefined,
      pathOrChannel: typeof attrs.pathOrChannel === 'string' ? attrs.pathOrChannel : undefined,
    };
  }

  resolveProject(nameOrId: string): KnowledgeNode {
    const raw = nameOrId.trim();
    if (!raw) {
      throw new Error('Project name is required');
    }

    const asId = raw.startsWith('project:') || raw.startsWith('tool:') ? raw : projectNodeId(raw);
    const direct = this.nodeById.get(asId);
    if (direct && isNxProjectNodeType(direct.type)) {
      return direct;
    }

    const byName = this.projectNodes.find((n) => (n.attrs as ProjectNodeAttrs).name === raw);
    if (byName) {
      return byName;
    }

    const lowered = raw.toLowerCase();
    const fuzzy = this.projectNodes.filter((n) => {
      const name = (n.attrs as ProjectNodeAttrs).name?.toLowerCase() ?? '';
      return name.includes(lowered) || n.id.toLowerCase().includes(lowered);
    });
    if (fuzzy.length === 1) {
      return fuzzy[0];
    }
    if (fuzzy.length > 1) {
      throw new Error(
        `Ambiguous project "${raw}". Candidates: ${fuzzy
          .slice(0, 8)
          .map((n) => (n.attrs as ProjectNodeAttrs).name)
          .join(', ')}`,
      );
    }

    throw new Error(`Unknown project "${raw}"`);
  }

  /**
   * Map a workspace-relative path to the owning project with the longest matching root.
   */
  projectForPath(relPath: string): KnowledgeNode | null {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const entry of this.projectsByRootDesc) {
      if (normalized === entry.root || normalized.startsWith(`${entry.root}/`)) {
        return entry.node;
      }
    }
    return null;
  }

  edgesOut(id: string, type?: string): KnowledgeEdge[] {
    const edges = this.out.get(id) ?? [];
    return type ? edges.filter((e) => e.type === type) : edges;
  }

  edgesIn(id: string, type?: string): KnowledgeEdge[] {
    const edges = this.inn.get(id) ?? [];
    return type ? edges.filter((e) => e.type === type) : edges;
  }

  getNode(id: string): KnowledgeNode | undefined {
    return this.nodeById.get(id);
  }
}

export function resolveGraphJsonPath(workspaceRoot: string, explicit?: string): string {
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.join(workspaceRoot, explicit);
  }
  return path.join(workspaceRoot, 'graph', 'graph.json');
}

export function resolveWorkspaceRoot(cwd = process.cwd()): string {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'nx.json')) || fs.existsSync(path.join(dir, 'graph', 'graph.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return cwd;
    }
    dir = parent;
  }
}
