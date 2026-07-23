import { ApiNodeAttrs, ConceptNodeAttrs, KnowledgeEdge, KnowledgeNode, ProjectNodeAttrs } from './schema';

export interface LinkDocumentsInput {
  conceptNodes: KnowledgeNode[];
  projectNodes: KnowledgeNode[];
  apiNodes: KnowledgeNode[];
  /** Optional map of concept id → raw doc text for richer matching */
  conceptTexts?: Map<string, string>;
}

/** Bare project names shorter than this need word-boundary matching (avoids `ai` / `graph` noise). */
export const MIN_PROJECT_NAME_SUBSTRING = 8;

/**
 * Build documents edges from concepts to projects/apis mentioned in titles or body text.
 */
export function linkDocuments(input: LinkDocumentsInput): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const projectNames = input.projectNodes
    .filter((n) => n.type === 'app' || n.type === 'lib')
    .map((n) => ({
      id: n.id,
      name: (n.attrs as ProjectNodeAttrs).name,
    }));

  const apis = input.apiNodes
    .filter((n) => n.type === 'endpoint' || n.type === 'channel')
    .map((n) => {
      const attrs = n.attrs as ApiNodeAttrs;
      return {
        id: n.id,
        pathOrChannel: attrs.pathOrChannel,
        operationId: attrs.operationId,
      };
    });

  for (const concept of input.conceptNodes) {
    if (concept.type !== 'concept') {
      continue;
    }
    const attrs = concept.attrs as ConceptNodeAttrs;
    const textParts = [attrs.title, attrs.docPath, input.conceptTexts?.get(concept.id) ?? ''];
    const haystack = textParts.join('\n').toLowerCase();

    for (const project of projectNames) {
      if (mentionsToken(haystack, project.name)) {
        addEdge(edges, seen, concept.id, project.id);
      }
    }

    for (const api of apis) {
      if (api.operationId && mentionsToken(haystack, api.operationId)) {
        addEdge(edges, seen, concept.id, api.id);
      }
      const pathToken = api.pathOrChannel.toLowerCase();
      // Require meaningful path/channel tokens to avoid noisy substring matches
      if (pathToken.length >= 6 && haystack.includes(pathToken)) {
        addEdge(edges, seen, concept.id, api.id);
      }
    }
  }

  return edges;
}

/**
 * Match a token in haystack. Short tokens require non-alphanumeric boundaries.
 */
export function mentionsToken(haystack: string, token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length >= MIN_PROJECT_NAME_SUBSTRING) {
    return haystack.includes(normalized);
  }
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = new RegExp(`(^|[^a-z0-9_/-])${escaped}([^a-z0-9_/-]|$)`, 'i');
  return boundary.test(haystack);
}

function addEdge(edges: KnowledgeEdge[], seen: Set<string>, from: string, to: string): void {
  const key = `${from}->${to}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  edges.push({ from, to, type: 'documents' });
}
