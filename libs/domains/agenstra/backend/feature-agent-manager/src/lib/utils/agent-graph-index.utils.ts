import { posix } from 'node:path';

import type {
  AgentGraphCommunitySummary,
  AgentGraphEdge,
  AgentGraphEdgeType,
  AgentGraphHub,
  AgentGraphNode,
  AgentGraphNodeType,
} from '@forepath/agenstra/shared/util-opencode-config';

import type { AgentGraphLayerData } from './agent-graph-builder.utils';

/** Node types that are structural hubs by construction (they are not interesting as "god nodes"). */
const STRUCTURAL_HUB_TYPES = new Set<AgentGraphNodeType>([
  'environment',
  'language',
  'directory',
  'mount',
  'workspace',
  'session',
]);

/**
 * Read-only query index over one graph layer (adjacency in both directions, degrees). Built once per loaded layer and
 * cached by the service; every query result is bounded by its `limit`.
 */
export class AgentGraphIndex {
  readonly nodes: AgentGraphNode[];
  readonly edges: AgentGraphEdge[];
  private readonly byId = new Map<string, AgentGraphNode>();
  private readonly outgoing = new Map<string, AgentGraphEdge[]>();
  private readonly incoming = new Map<string, AgentGraphEdge[]>();

  constructor(layer: AgentGraphLayerData) {
    this.nodes = layer.nodes;
    this.edges = layer.edges;

    for (const node of layer.nodes) {
      this.byId.set(node.id, node);
    }

    for (const edge of layer.edges) {
      if (!this.byId.has(edge.from) || !this.byId.has(edge.to)) {
        continue;
      }

      push(this.outgoing, edge.from, edge);
      push(this.incoming, edge.to, edge);
    }
  }

  get size(): number {
    return this.nodes.length;
  }

  getNode(id: string): AgentGraphNode | undefined {
    return this.byId.get(id);
  }

  degree(id: string): number {
    return (this.outgoing.get(id)?.length ?? 0) + (this.incoming.get(id)?.length ?? 0);
  }

  edgesOut(id: string, type?: AgentGraphEdgeType): AgentGraphEdge[] {
    const list = this.outgoing.get(id) ?? [];

    return type ? list.filter((edge) => edge.type === type) : list;
  }

  edgesIn(id: string, type?: AgentGraphEdgeType): AgentGraphEdge[] {
    const list = this.incoming.get(id) ?? [];

    return type ? list.filter((edge) => edge.type === type) : list;
  }

  detail(
    id: string,
    limit: number,
  ):
    | {
        node: AgentGraphNode;
        outgoing: { edge: AgentGraphEdge; node: AgentGraphNode }[];
        incoming: { edge: AgentGraphEdge; node: AgentGraphNode }[];
        truncated: boolean;
      }
    | undefined {
    const node = this.byId.get(id);

    if (!node) {
      return undefined;
    }

    const out = this.edgesOut(id);
    const inn = this.edgesIn(id);
    const map = (edges: AgentGraphEdge[], key: 'from' | 'to') =>
      edges
        .slice(0, limit)
        .map((edge) => ({ edge, node: this.byId.get(edge[key]) as AgentGraphNode }))
        .filter((entry) => !!entry.node);

    return {
      node,
      outgoing: map(out, 'to'),
      incoming: map(inn, 'from'),
      truncated: out.length > limit || inn.length > limit,
    };
  }

  /** Case-insensitive search over label, path and id; scored by match quality, then degree. */
  search(
    query: string,
    limit: number,
    types?: ReadonlySet<AgentGraphNodeType>,
  ): { node: AgentGraphNode; score: number }[] {
    const needle = query.trim().toLowerCase();

    if (!needle) {
      return [];
    }

    const hits: { node: AgentGraphNode; score: number }[] = [];

    for (const node of this.nodes) {
      if (types && types.size > 0 && !types.has(node.type)) {
        continue;
      }

      const label = node.label.toLowerCase();
      const path = node.path?.toLowerCase() ?? '';
      let score = 0;

      if (label === needle) {
        score = 100;
      } else if (label.startsWith(needle)) {
        score = 70;
      } else if (label.includes(needle)) {
        score = 50;
      } else if (path && (path === needle || path.endsWith(`/${needle}`))) {
        score = 60;
      } else if (path.includes(needle)) {
        score = 30;
      } else if (node.id.toLowerCase().includes(needle)) {
        score = 15;
      }

      if (score > 0) {
        hits.push({ node, score: score + Math.min(10, Math.log2(1 + this.degree(node.id))) });
      }
    }

    return hits.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id)).slice(0, limit);
  }

  /** Undirected BFS neighbourhood (`depth` hops, at most `limit` nodes). */
  neighborhood(
    id: string,
    depth: number,
    limit: number,
    edgeTypes?: ReadonlySet<AgentGraphEdgeType>,
  ): AgentGraphLayerData & { truncated: boolean } {
    if (!this.byId.has(id)) {
      return { nodes: [], edges: [], truncated: false };
    }

    const selected = new Set<string>([id]);
    let frontier = [id];
    let truncated = false;

    for (let hop = 0; hop < depth && frontier.length > 0 && !truncated; hop++) {
      const next: string[] = [];

      for (const current of frontier) {
        for (const edge of [...this.edgesOut(current), ...this.edgesIn(current)]) {
          if (edgeTypes && edgeTypes.size > 0 && !edgeTypes.has(edge.type)) {
            continue;
          }

          const other = edge.from === current ? edge.to : edge.from;

          if (selected.has(other)) {
            continue;
          }

          if (selected.size >= limit) {
            truncated = true;
            break;
          }

          selected.add(other);
          next.push(other);
        }

        if (truncated) {
          break;
        }
      }

      frontier = next;
    }

    return { ...this.induced(selected), truncated };
  }

  /** Shortest undirected path between two nodes (BFS, bounded depth). */
  shortestPath(from: string, to: string, maxDepth: number): AgentGraphLayerData | undefined {
    if (!this.byId.has(from) || !this.byId.has(to)) {
      return undefined;
    }

    if (from === to) {
      return { nodes: [this.byId.get(from) as AgentGraphNode], edges: [] };
    }

    const previous = new Map<string, { node: string; edge: AgentGraphEdge }>();
    const visited = new Set([from]);
    let frontier = [from];

    for (let hop = 0; hop < maxDepth && frontier.length > 0; hop++) {
      const next: string[] = [];

      for (const current of frontier) {
        for (const edge of [...this.edgesOut(current), ...this.edgesIn(current)]) {
          const other = edge.from === current ? edge.to : edge.from;

          if (visited.has(other)) {
            continue;
          }

          visited.add(other);
          previous.set(other, { node: current, edge });

          if (other === to) {
            const nodes: AgentGraphNode[] = [];
            const edges: AgentGraphEdge[] = [];
            let cursor: string | undefined = to;

            while (cursor) {
              nodes.unshift(this.byId.get(cursor) as AgentGraphNode);

              const step = previous.get(cursor);

              if (!step) {
                break;
              }

              edges.unshift(step.edge);
              cursor = step.node;
            }

            return { nodes, edges };
          }

          next.push(other);
        }
      }

      frontier = next;
    }

    return undefined;
  }

  /**
   * A bounded slice for rendering: highest-degree nodes first (environment / module nodes always kept), edges
   * between kept nodes only.
   */
  slice(limit: number, types?: ReadonlySet<AgentGraphNodeType>): AgentGraphLayerData & { truncated: boolean } {
    const candidates = types && types.size > 0 ? this.nodes.filter((node) => types.has(node.type)) : this.nodes;

    if (candidates.length <= limit) {
      return { ...this.induced(new Set(candidates.map((node) => node.id))), truncated: false };
    }

    const priority = (node: AgentGraphNode): number =>
      node.type === 'environment' || node.type === 'workspace' ? 2 : node.type === 'module' ? 1 : 0;
    const ranked = [...candidates].sort(
      (a, b) => priority(b) - priority(a) || this.degree(b.id) - this.degree(a.id) || a.id.localeCompare(b.id),
    );

    return { ...this.induced(new Set(ranked.slice(0, limit).map((node) => node.id))), truncated: true };
  }

  hubs(limit: number): AgentGraphHub[] {
    return this.nodes
      .filter((node) => !STRUCTURAL_HUB_TYPES.has(node.type))
      .map((node) => ({ node, degree: this.degree(node.id) }))
      .filter((entry) => entry.degree > 0)
      .sort((a, b) => b.degree - a.degree || a.node.id.localeCompare(b.node.id))
      .slice(0, limit)
      .map(({ node, degree }) => ({
        id: node.id,
        type: node.type,
        label: node.label,
        ...(node.path ? { path: node.path } : {}),
        degree,
      }));
  }

  communities(limit: number): AgentGraphCommunitySummary[] {
    const groups = new Map<number, AgentGraphNode[]>();

    for (const node of this.nodes) {
      if (node.community === undefined) {
        continue;
      }

      const list = groups.get(node.community) ?? [];

      list.push(node);
      groups.set(node.community, list);
    }

    return [...groups.entries()]
      .filter(([, members]) => members.length > 1)
      .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
      .slice(0, limit)
      .map(([id, members]) => {
        const lead = members.reduce((best, node) => (this.degree(node.id) > this.degree(best.id) ? node : best));
        const directories = new Map<string, number>();

        for (const member of members) {
          if (member.path) {
            const directory = posix.dirname(member.path);

            directories.set(directory, (directories.get(directory) ?? 0) + 1);
          }
        }

        const directory = [...directories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

        return { id, size: members.length, label: lead.label, ...(directory ? { directory } : {}) };
      });
  }

  private induced(ids: Set<string>): AgentGraphLayerData {
    return {
      nodes: this.nodes.filter((node) => ids.has(node.id)),
      edges: this.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    };
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);

  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}
