import { ApiNodeAttrs, ConceptNodeAttrs, KnowledgeNode, ProjectNodeAttrs } from '../schema';
import { KnowledgeGraphIndex, NodeSummary } from './graph-index';

const ARCH_CONTAIN_TYPES = new Set([
  'openapi',
  'asyncapi',
  'controller',
  'gateway',
  'service',
  'repository',
  'entity',
  'dto',
  'guard',
  'module',
  'provider',
  'email',
  'webhook-event',
  'state',
  'job',
  'diagram',
  'readme',
]);

/** Sample-list limits for R1 payloads (token budget). Totals use *Count / containsTotals. */
export const R1_SAMPLE_CAPS = {
  containsPerType: 40,
  endpoints: 80,
  channels: 80,
  documents: 80,
  injectSources: 25,
  injectTargetsPerSource: 20,
  provideModules: 15,
  provideTargetsPerModule: 30,
} as const;

const R1_SAMPLES_NOTE =
  'List fields (containsByType, endpoints, channels, documents, injectsFromSources, providesFromModules) are samples truncated for token budget. Use endpointCount, channelCount, documentCount, and containsTotals for full sizes — do not treat sampled array .length as complete.';

export interface RecipeR1Result {
  recipe: 'R1';
  project: NodeSummary & { domain?: string; context?: string; tags?: string[] };
  dependsOn: { out: NodeSummary[]; in: NodeSummary[] };
  containsByType: Record<string, NodeSummary[]>;
  containsTotals: Record<string, number>;
  endpoints: NodeSummary[];
  channels: NodeSummary[];
  documents: Array<NodeSummary & { title?: string; sectionAnchor?: string }>;
  endpointCount: number;
  channelCount: number;
  documentCount: number;
  injectsFromSources: Array<{ from: NodeSummary; to: NodeSummary[] }>;
  providesFromModules: Array<{ from: NodeSummary; to: NodeSummary[] }>;
  /** Always present so agents see that lists are samples. */
  samples: {
    note: string;
    caps: typeof R1_SAMPLE_CAPS;
  };
}

function projectSummary(index: KnowledgeGraphIndex, node: KnowledgeNode): RecipeR1Result['project'] {
  const attrs = node.attrs as ProjectNodeAttrs;
  return {
    ...index.summarize(node),
    domain: attrs.domain,
    context: attrs.context,
    tags: attrs.tags,
  };
}

/**
 * Recipe R1 — blast radius for a project.
 * List fields are capped samples; *Count / containsTotals are complete.
 */
export function recipeR1(
  index: KnowledgeGraphIndex,
  projectName: string,
  options?: { maxPerType?: number },
): RecipeR1Result {
  const maxPerType = options?.maxPerType ?? R1_SAMPLE_CAPS.containsPerType;
  const project = index.resolveProject(projectName);
  const pid = project.id;

  const dependsOut = index
    .edgesOut(pid, 'depends_on')
    .map((e) => index.getNode(e.to))
    .filter((n): n is KnowledgeNode => !!n)
    .map((n) => index.summarize(n));

  const dependsIn = index
    .edgesIn(pid, 'depends_on')
    .map((e) => index.getNode(e.from))
    .filter((n): n is KnowledgeNode => !!n)
    .map((n) => index.summarize(n));

  const containsByType: Record<string, NodeSummary[]> = {};
  const containsTotals: Record<string, number> = {};
  const surfaceParents: KnowledgeNode[] = [];

  for (const edge of index.edgesOut(pid, 'contains')) {
    const child = index.getNode(edge.to);
    if (!child) continue;
    containsTotals[child.type] = (containsTotals[child.type] ?? 0) + 1;
    if (!containsByType[child.type]) containsByType[child.type] = [];
    if (containsByType[child.type].length < maxPerType) {
      containsByType[child.type].push(index.summarize(child));
    }
    if (ARCH_CONTAIN_TYPES.has(child.type) || child.type === 'openapi' || child.type === 'asyncapi') {
      surfaceParents.push(child);
    }
  }

  const endpoints: NodeSummary[] = [];
  const channels: NodeSummary[] = [];
  let endpointCount = 0;
  let channelCount = 0;
  const seenSurface = new Set<string>();

  for (const parent of surfaceParents) {
    for (const edge of index.edgesOut(parent.id, 'contains')) {
      const surface = index.getNode(edge.to);
      if (!surface || seenSurface.has(surface.id)) continue;
      if (surface.type === 'endpoint') {
        seenSurface.add(surface.id);
        endpointCount += 1;
        if (endpoints.length < R1_SAMPLE_CAPS.endpoints) endpoints.push(index.summarize(surface));
      } else if (surface.type === 'channel') {
        seenSurface.add(surface.id);
        channelCount += 1;
        if (channels.length < R1_SAMPLE_CAPS.channels) channels.push(index.summarize(surface));
      }
    }
  }

  const docConcepts = new Map<string, KnowledgeNode>();
  for (const edge of index.edgesIn(pid, 'documents')) {
    const concept = index.getNode(edge.from);
    if (concept?.type === 'concept') docConcepts.set(concept.id, concept);
  }
  for (const surfaceId of seenSurface) {
    for (const edge of index.edgesIn(surfaceId, 'documents')) {
      const concept = index.getNode(edge.from);
      if (concept?.type === 'concept') docConcepts.set(concept.id, concept);
    }
  }

  const documentCount = docConcepts.size;
  const documents = [...docConcepts.values()].slice(0, R1_SAMPLE_CAPS.documents).map((n) => {
    const attrs = n.attrs as ConceptNodeAttrs;
    return {
      ...index.summarize(n),
      title: attrs.title,
      sectionAnchor: attrs.sectionAnchor,
    };
  });

  const injectSources = surfaceParents.filter((n) =>
    ['controller', 'gateway', 'service', 'job', 'provider', 'state'].includes(n.type),
  );
  const injectsFromSources: RecipeR1Result['injectsFromSources'] = [];
  for (const src of injectSources.slice(0, R1_SAMPLE_CAPS.injectSources)) {
    const tos = index
      .edgesOut(src.id, 'injects')
      .map((e) => index.getNode(e.to))
      .filter((n): n is KnowledgeNode => !!n)
      .map((n) => index.summarize(n));
    if (tos.length) {
      injectsFromSources.push({
        from: index.summarize(src),
        to: tos.slice(0, R1_SAMPLE_CAPS.injectTargetsPerSource),
      });
    }
  }

  const modules = surfaceParents.filter((n) => n.type === 'module');
  const providesFromModules: RecipeR1Result['providesFromModules'] = [];
  for (const mod of modules.slice(0, R1_SAMPLE_CAPS.provideModules)) {
    const tos = index
      .edgesOut(mod.id, 'provides')
      .map((e) => index.getNode(e.to))
      .filter((n): n is KnowledgeNode => !!n)
      .map((n) => index.summarize(n));
    if (tos.length) {
      providesFromModules.push({
        from: index.summarize(mod),
        to: tos.slice(0, R1_SAMPLE_CAPS.provideTargetsPerModule),
      });
    }
  }

  return {
    recipe: 'R1',
    project: projectSummary(index, project),
    dependsOn: { out: dependsOut, in: dependsIn },
    containsByType,
    containsTotals,
    endpoints,
    channels,
    documents,
    endpointCount,
    channelCount,
    documentCount,
    injectsFromSources,
    providesFromModules,
    samples: {
      note: R1_SAMPLES_NOTE,
      caps: R1_SAMPLE_CAPS,
    },
  };
}

export interface RecipeR2Result {
  recipe: 'R2';
  project: NodeSummary;
  concepts: Array<NodeSummary & { title?: string; sectionAnchor?: string; docPath?: string }>;
  docPaths: string[];
}

/**
 * Recipe R2 — docs that document a project (optionally its endpoints/channels).
 */
export function recipeR2(
  index: KnowledgeGraphIndex,
  projectName: string,
  options?: { includeEndpoints?: boolean },
): RecipeR2Result {
  const includeEndpoints = options?.includeEndpoints !== false;
  const project = index.resolveProject(projectName);
  const concepts = new Map<string, KnowledgeNode>();

  for (const edge of index.edgesIn(project.id, 'documents')) {
    const n = index.getNode(edge.from);
    if (n?.type === 'concept') concepts.set(n.id, n);
  }

  if (includeEndpoints) {
    for (const edge of index.edgesOut(project.id, 'contains')) {
      const child = index.getNode(edge.to);
      if (!child) continue;
      for (const e2 of index.edgesOut(child.id, 'contains')) {
        const surface = index.getNode(e2.to);
        if (!surface || (surface.type !== 'endpoint' && surface.type !== 'channel')) continue;
        for (const e3 of index.edgesIn(surface.id, 'documents')) {
          const n = index.getNode(e3.from);
          if (n?.type === 'concept') concepts.set(n.id, n);
        }
      }
    }
  }

  const conceptSummaries = [...concepts.values()].map((n) => {
    const attrs = n.attrs as ConceptNodeAttrs;
    return {
      ...index.summarize(n),
      title: attrs.title,
      sectionAnchor: attrs.sectionAnchor,
      docPath: attrs.docPath,
    };
  });

  const docPaths = [...new Set(conceptSummaries.map((c) => c.docPath).filter((p): p is string => !!p))].sort();

  return {
    recipe: 'R2',
    project: index.summarize(project),
    concepts: conceptSummaries,
    docPaths,
  };
}

export interface RecipeR3Result {
  recipe: 'R3';
  surface: NodeSummary & { operationId?: string; method?: string; pathOrChannel?: string };
  specs: NodeSummary[];
  owners: NodeSummary[];
  implementers: NodeSummary[];
  callers: NodeSummary[];
  documents: Array<NodeSummary & { title?: string; docPath?: string }>;
  siblings: NodeSummary[];
  injects: NodeSummary[];
}

export interface RecipeR3Query {
  id?: string;
  method?: string;
  path?: string;
  operationId?: string;
  channel?: string;
}

/**
 * Recipe R3 — owners/implementers/docs for one HTTP endpoint or AsyncAPI channel.
 */
export function recipeR3(index: KnowledgeGraphIndex, query: RecipeR3Query): RecipeR3Result {
  const surface = resolveSurface(index, query);
  const specs: KnowledgeNode[] = [];
  for (const edge of index.edgesIn(surface.id, 'contains')) {
    const parent = index.getNode(edge.from);
    if (parent && (parent.type === 'openapi' || parent.type === 'asyncapi')) {
      specs.push(parent);
    }
  }

  const owners: KnowledgeNode[] = [];
  for (const spec of specs) {
    for (const edge of index.edgesIn(spec.id, 'contains')) {
      const owner = index.getNode(edge.from);
      if (owner && (owner.type === 'app' || owner.type === 'lib' || owner.type === 'tool')) {
        owners.push(owner);
      }
    }
  }

  const implementers = index
    .edgesIn(surface.id, 'implements')
    .map((e) => index.getNode(e.from))
    .filter((n): n is KnowledgeNode => !!n);

  const callers = index
    .edgesIn(surface.id, 'calls')
    .map((e) => index.getNode(e.from))
    .filter((n): n is KnowledgeNode => !!n);

  const documents = index
    .edgesIn(surface.id, 'documents')
    .map((e) => index.getNode(e.from))
    .filter((n): n is KnowledgeNode => !!n && n.type === 'concept')
    .map((n) => {
      const attrs = n.attrs as ConceptNodeAttrs;
      return { ...index.summarize(n), title: attrs.title, docPath: attrs.docPath };
    });

  const siblings: NodeSummary[] = [];
  const seen = new Set<string>([surface.id]);
  for (const spec of specs) {
    for (const edge of index.edgesOut(spec.id, 'contains')) {
      if (seen.has(edge.to)) continue;
      const sib = index.getNode(edge.to);
      if (!sib || (sib.type !== 'endpoint' && sib.type !== 'channel')) continue;
      seen.add(sib.id);
      if (siblings.length < 40) siblings.push(index.summarize(sib));
    }
  }

  const injects: NodeSummary[] = [];
  for (const impl of implementers) {
    for (const edge of index.edgesOut(impl.id, 'injects')) {
      const target = index.getNode(edge.to);
      if (target) injects.push(index.summarize(target));
    }
  }

  const attrs = surface.attrs as ApiNodeAttrs;
  return {
    recipe: 'R3',
    surface: {
      ...index.summarize(surface),
      operationId: attrs.operationId,
      method: attrs.method,
      pathOrChannel: attrs.pathOrChannel,
    },
    specs: specs.map((n) => index.summarize(n)),
    owners: owners.map((n) => index.summarize(n)),
    implementers: implementers.map((n) => index.summarize(n)),
    callers: callers.map((n) => index.summarize(n)),
    documents,
    siblings,
    injects: injects.slice(0, 40),
  };
}

function resolveSurface(index: KnowledgeGraphIndex, query: RecipeR3Query): KnowledgeNode {
  if (query.id) {
    const node = index.getNode(query.id);
    if (!node || (node.type !== 'endpoint' && node.type !== 'channel')) {
      throw new Error(`No endpoint/channel node with id ${query.id}`);
    }
    return node;
  }

  if (query.channel) {
    const id = query.channel.startsWith('api:channel:') ? query.channel : `api:channel:${query.channel}`;
    const node = index.getNode(id);
    if (node) return node;
    const match = index.graph.nodes.find(
      (n) => n.type === 'channel' && (n.attrs as ApiNodeAttrs).pathOrChannel === query.channel,
    );
    if (match) return match;
    throw new Error(`Unknown channel "${query.channel}"`);
  }

  if (query.operationId) {
    const match = index.graph.nodes.find(
      (n) => n.type === 'endpoint' && (n.attrs as ApiNodeAttrs).operationId === query.operationId,
    );
    if (match) return match;
    throw new Error(`Unknown operationId "${query.operationId}"`);
  }

  if (query.method && query.path) {
    const method = query.method.toUpperCase();
    const pathOrChannel = query.path.startsWith('/') ? query.path : `/${query.path}`;
    const id = `api:HTTP:${method}:${pathOrChannel}`;
    const direct = index.getNode(id);
    if (direct) return direct;
    const match = index.graph.nodes.find((n) => {
      if (n.type !== 'endpoint') return false;
      const attrs = n.attrs as ApiNodeAttrs;
      return attrs.method?.toUpperCase() === method && attrs.pathOrChannel === pathOrChannel;
    });
    if (match) return match;
    throw new Error(`Unknown endpoint ${method} ${pathOrChannel}`);
  }

  throw new Error('Provide id, channel, operationId, or method+path');
}

export interface RecipeR5Result {
  recipe: 'R5';
  keyword: string;
  hits: NodeSummary[];
  byType: Record<string, number>;
}

/**
 * Recipe R5 — keyword search across node ids and common attrs.
 */
export function recipeR5(index: KnowledgeGraphIndex, keyword: string, options?: { limit?: number }): RecipeR5Result {
  const q = keyword.trim().toLowerCase();
  if (!q) throw new Error('keyword is required');
  const limit = options?.limit ?? 60;
  const hits: NodeSummary[] = [];
  const byType: Record<string, number> = {};

  for (const node of index.graph.nodes) {
    const attrs = node.attrs as unknown as Record<string, unknown>;
    const hay = [
      node.id,
      node.type,
      attrs.name,
      attrs.title,
      attrs.path,
      attrs.root,
      attrs.docPath,
      attrs.pathOrChannel,
      attrs.operationId,
      attrs.summary,
      attrs.eventName,
      attrs.templateName,
      attrs.sliceName,
    ]
      .filter((v) => typeof v === 'string')
      .join('\n')
      .toLowerCase();

    if (!hay.includes(q)) continue;
    byType[node.type] = (byType[node.type] ?? 0) + 1;
    if (hits.length < limit) hits.push(index.summarize(node));
  }

  return { recipe: 'R5', keyword, hits, byType };
}
