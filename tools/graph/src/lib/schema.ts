/**
 * Knowledge graph schema for the Forepath Nx monorepo.
 *
 * Node ids:
 * - project:<nxName> (apps and libs; `type` is `app` or `lib`)
 * - domain:<name> | context:<name> | feature-group:<name> (cluster labels)
 * - file:<posixRelPath> (controllers, docs, specs, diagrams;
 *   `type` is `file`|`doc`|`readme`|`openapi`|`asyncapi`|`diagram`)
 * - api:HTTP:<METHOD>:<path> | api:channel:<name> (node `type`: `endpoint`)
 * - concept:<slug>
 *
 * Edge types: depends_on | contains | implements | documents | belongs_to
 */

/** Supported knowledge-graph node kinds. */
export type KnowledgeNodeType =
  | 'app'
  | 'lib'
  | 'domain'
  | 'context'
  | 'feature-group'
  | 'file'
  | 'doc'
  | 'readme'
  | 'openapi'
  | 'asyncapi'
  | 'diagram'
  | 'endpoint'
  | 'concept';

/** Supported knowledge-graph edge kinds. */
export type KnowledgeEdgeType = 'depends_on' | 'contains' | 'implements' | 'documents' | 'belongs_to';

/** Nx project classification (mirrors node.type for app/lib nodes). */
export type ProjectNodeKind = 'app' | 'lib';

/** Cluster classification for domain maps. */
export type ClusterKind = 'domain' | 'context' | 'feature-group';

/** File kind for indexed files. */
export type FileLanguageOrKind = 'ts' | 'openapi' | 'asyncapi' | 'md' | 'mmd';

export interface ProjectNodeAttrs {
  name: string;
  root: string;
  tags: string[];
  /** Same as the node `type` (`app` or `lib`). */
  type: ProjectNodeKind;
  targets: string[];
  /** Product domain from `domain:*` tag or path inference. */
  domain?: string;
  /** Bounded context from `scope:*` tag. */
  context?: string;
  /** Feature group from `type:*` tag. */
  featureGroup?: string;
}

export interface ClusterNodeAttrs {
  name: string;
  kind: ClusterKind;
  /** Human label: domain | bounded context | feature group */
  label: string;
  /** How the cluster was derived. */
  source: 'tag' | 'path' | 'docs';
}

export interface FileNodeAttrs {
  path: string;
  languageOrKind: FileLanguageOrKind;
  projectName?: string;
}

export interface ApiNodeAttrs {
  method?: string;
  pathOrChannel: string;
  operationId?: string;
  summary?: string;
  specKind: 'openapi' | 'asyncapi';
}

export interface ConceptNodeAttrs {
  title: string;
  docPath: string;
  sectionAnchor?: string;
  domain?: string;
}

export type KnowledgeNodeAttrs = ProjectNodeAttrs | ClusterNodeAttrs | FileNodeAttrs | ApiNodeAttrs | ConceptNodeAttrs;

export interface KnowledgeNode {
  id: string;
  type: KnowledgeNodeType;
  attrs: KnowledgeNodeAttrs;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  type: KnowledgeEdgeType;
}

export interface KnowledgeGraph {
  version: 1;
  generatedAt: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export function projectNodeId(name: string): string {
  return `project:${name}`;
}

export function domainNodeId(name: string): string {
  return `domain:${slugify(name)}`;
}

export function contextNodeId(name: string): string {
  return `context:${slugify(name)}`;
}

export function featureGroupNodeId(name: string): string {
  return `feature-group:${slugify(name)}`;
}

export function isNxProjectNodeType(type: string): type is ProjectNodeKind {
  return type === 'app' || type === 'lib';
}

export type FileDerivedNodeType = 'file' | 'doc' | 'readme' | 'openapi' | 'asyncapi' | 'diagram';

/** Map discovered file kind (and path for markdown) to a knowledge-graph node type. */
export function fileNodeTypeFromKind(kind: FileLanguageOrKind, relativePath = ''): FileDerivedNodeType {
  if (kind === 'openapi') {
    return 'openapi';
  }
  if (kind === 'asyncapi') {
    return 'asyncapi';
  }
  if (kind === 'mmd') {
    return 'diagram';
  }
  if (kind === 'md') {
    const normalized = relativePath.replace(/\\/g, '/');
    if (normalized === 'docs' || normalized.startsWith('docs/')) {
      return 'doc';
    }
    return 'readme';
  }
  return 'file';
}

export function fileNodeId(relativePath: string): string {
  return `file:${relativePath.replace(/\\/g, '/')}`;
}

export function httpApiNodeId(method: string, path: string): string {
  return `api:HTTP:${method.toUpperCase()}:${path}`;
}

export function channelApiNodeId(channel: string): string {
  return `api:channel:${channel}`;
}

export function conceptNodeId(slug: string): string {
  return `concept:${slug}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
