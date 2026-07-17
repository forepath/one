import {
  ClusterKind,
  ClusterNodeAttrs,
  KnowledgeEdge,
  KnowledgeNode,
  ProjectNodeAttrs,
  contextNodeId,
  domainNodeId,
  featureGroupNodeId,
} from './schema';

export interface ClusterSlice {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  /** Project id → enriched attrs with cluster fields */
  projectAttrUpdates: Map<string, Partial<ProjectNodeAttrs>>;
}

function parsePrefixedTag(tag: string): { prefix: string; value: string } | null {
  const idx = tag.indexOf(':');
  if (idx <= 0 || idx === tag.length - 1) {
    return null;
  }
  return {
    prefix: tag.slice(0, idx).toLowerCase(),
    value: tag.slice(idx + 1).trim(),
  };
}

/** Infer product domain from common monorepo path layouts. */
export function inferDomainFromPath(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  const libsMatch = normalized.match(/^libs\/domains\/([^/]+)\//);
  if (libsMatch) {
    return libsMatch[1];
  }
  const appsMatch = normalized.match(/^apps\/([^/]+)\//);
  if (appsMatch) {
    return appsMatch[1];
  }
  const docsMatch = normalized.match(/^docs\/([^/]+)\//);
  if (docsMatch) {
    return docsMatch[1];
  }
  return undefined;
}

function clusterAttrs(kind: ClusterKind, name: string, source: ClusterNodeAttrs['source']): ClusterNodeAttrs {
  return {
    name,
    kind,
    label: kind === 'domain' ? 'domain' : kind === 'context' ? 'bounded context' : 'feature group',
    source,
  };
}

/**
 * Build first-class cluster nodes (domain / context / feature-group) from Nx tags
 * and path inference; wire `belongs_to` from projects (and docs/concepts when domain known).
 */
export function buildClusterSlice(options: {
  projectNodes: KnowledgeNode[];
  fileNodes?: KnowledgeNode[];
  conceptNodes?: KnowledgeNode[];
}): ClusterSlice {
  const nodesById = new Map<string, KnowledgeNode>();
  const edges: KnowledgeEdge[] = [];
  const edgeKeys = new Set<string>();
  const projectAttrUpdates = new Map<string, Partial<ProjectNodeAttrs>>();

  const ensureCluster = (
    id: string,
    type: 'domain' | 'context' | 'feature-group',
    kind: ClusterKind,
    name: string,
    source: ClusterNodeAttrs['source'],
  ): void => {
    if (nodesById.has(id)) {
      return;
    }
    nodesById.set(id, {
      id,
      type,
      attrs: clusterAttrs(kind, name, source),
    });
  };

  const addBelongsTo = (from: string, to: string): void => {
    const key = `belongs_to|${from}|${to}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push({ from, to, type: 'belongs_to' });
  };

  for (const project of options.projectNodes) {
    if (project.type !== 'app' && project.type !== 'lib') {
      continue;
    }
    const attrs = project.attrs as ProjectNodeAttrs;
    const tags = attrs.tags ?? [];
    let domainName: string | undefined;
    let contextName: string | undefined;
    let featureGroupName: string | undefined;
    let domainSource: ClusterNodeAttrs['source'] = 'tag';

    for (const tag of tags) {
      const parsed = parsePrefixedTag(tag);
      if (!parsed) {
        continue;
      }
      if (parsed.prefix === 'domain' && !domainName) {
        domainName = parsed.value;
        domainSource = 'tag';
      } else if (parsed.prefix === 'scope' && !contextName) {
        contextName = parsed.value;
      } else if (parsed.prefix === 'type' && !featureGroupName) {
        featureGroupName = parsed.value;
      }
    }

    if (!domainName) {
      const inferred = inferDomainFromPath(attrs.root);
      if (inferred) {
        domainName = inferred;
        domainSource = 'path';
      }
    }

    const updates: Partial<ProjectNodeAttrs> = {};
    if (domainName) {
      const id = domainNodeId(domainName);
      ensureCluster(id, 'domain', 'domain', domainName, domainSource);
      addBelongsTo(project.id, id);
      updates.domain = domainName;
    }
    if (contextName) {
      const id = contextNodeId(contextName);
      ensureCluster(id, 'context', 'context', contextName, 'tag');
      addBelongsTo(project.id, id);
      updates.context = contextName;
    }
    if (featureGroupName) {
      const id = featureGroupNodeId(featureGroupName);
      ensureCluster(id, 'feature-group', 'feature-group', featureGroupName, 'tag');
      addBelongsTo(project.id, id);
      updates.featureGroup = featureGroupName;
    }
    if (Object.keys(updates).length) {
      projectAttrUpdates.set(project.id, updates);
    }
  }

  for (const file of options.fileNodes ?? []) {
    if (file.type !== 'doc') {
      continue;
    }
    const pathAttr = (file.attrs as { path?: string }).path;
    if (!pathAttr) {
      continue;
    }
    const domainName = inferDomainFromPath(pathAttr);
    if (!domainName) {
      continue;
    }
    const id = domainNodeId(domainName);
    ensureCluster(id, 'domain', 'domain', domainName, 'path');
    addBelongsTo(file.id, id);
  }

  for (const concept of options.conceptNodes ?? []) {
    if (concept.type !== 'concept') {
      continue;
    }
    const domainName = (concept.attrs as { domain?: string }).domain;
    if (!domainName) {
      continue;
    }
    const id = domainNodeId(domainName);
    ensureCluster(id, 'domain', 'domain', domainName, 'docs');
    addBelongsTo(concept.id, id);
  }

  return {
    nodes: [...nodesById.values()],
    edges,
    projectAttrUpdates,
  };
}
