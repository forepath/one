import { ApiNodeAttrs, ConceptNodeAttrs, KnowledgeEdge, KnowledgeNode, ProjectNodeAttrs } from './schema';

export interface LinkDocumentsInput {
  conceptNodes: KnowledgeNode[];
  projectNodes: KnowledgeNode[];
  apiNodes: KnowledgeNode[];
  /** Optional map of concept id → raw doc text for richer matching */
  conceptTexts?: Map<string, string>;
}

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
    .filter((n) => n.type === 'endpoint')
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
      if (haystack.includes(project.name.toLowerCase())) {
        addEdge(edges, seen, concept.id, project.id);
      }
    }

    for (const api of apis) {
      if (api.operationId && haystack.includes(api.operationId.toLowerCase())) {
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

function addEdge(edges: KnowledgeEdge[], seen: Set<string>, from: string, to: string): void {
  const key = `${from}->${to}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  edges.push({ from, to, type: 'documents' });
}
