/**
 * Knowledge graph schema for the Forepath Nx monorepo.
 *
 * Node ids:
 * - project:<nxName> (apps, libs, tools; `type` is `app` | `lib` | `tool`)
 * - tool:<dirname> (non-Nx directories under tools/)
 * - package:<npmName> (production npm deps attributed to apps via Nx createPackageJson)
 * - patch:<filename> (patch-package files under patches/)
 * - domain:<name> | context:<name> | feature-group:<name> (cluster labels)
 * - file:<posixRelPath> (path-based sources; `type` is a FileDerivedNodeType)
 * - api:HTTP:<METHOD>:<path> (node `type`: `endpoint` from OpenAPI)
 * - api:channel:<name> (node `type`: `channel` from AsyncAPI)
 * - webhook-event:<project>:<eventName> (outbound notification / webhook event)
 * - concept:<slug>
 *
 * Edge types: depends_on | contains | implements | injects | provides | calls | documents | belongs_to
 */

/** Supported knowledge-graph node kinds. */
export type KnowledgeNodeType =
  | 'app'
  | 'lib'
  | 'tool'
  | 'package'
  | 'patch'
  | 'domain'
  | 'context'
  | 'feature-group'
  | 'controller'
  | 'gateway'
  | 'job'
  | 'service'
  | 'repository'
  | 'entity'
  | 'dto'
  | 'guard'
  | 'module'
  | 'state'
  | 'provider'
  | 'email'
  | 'webhook-event'
  | 'doc'
  | 'readme'
  | 'openapi'
  | 'asyncapi'
  | 'diagram'
  | 'endpoint'
  | 'channel'
  | 'concept';

/** Supported knowledge-graph edge kinds. */
export type KnowledgeEdgeType =
  | 'depends_on'
  | 'contains'
  | 'implements'
  | 'injects'
  | 'provides'
  | 'calls'
  | 'documents'
  | 'belongs_to';

/** Nx / workspace project classification (mirrors node.type for project-like nodes). */
export type ProjectNodeKind = 'app' | 'lib' | 'tool';

/** Cluster classification for domain maps. */
export type ClusterKind = 'domain' | 'context' | 'feature-group';

/** File kind for indexed files. */
export type FileLanguageOrKind = 'ts' | 'openapi' | 'asyncapi' | 'md' | 'mmd' | 'template';

export interface ProjectNodeAttrs {
  name: string;
  root: string;
  tags: string[];
  /** Same as the node `type` (`app`, `lib`, or `tool`). */
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
  /** NgRx slice name when `type` is `state`. */
  sliceName?: string;
  /** Email template stem when `type` is `email`. */
  templateName?: string;
  /** Member basenames for accumulated `state` / `email` nodes. */
  memberFiles?: string[];
}

export interface ApiNodeAttrs {
  method?: string;
  pathOrChannel: string;
  operationId?: string;
  summary?: string;
  specKind: 'openapi' | 'asyncapi';
}

export interface WebhookEventNodeAttrs {
  eventName: string;
  projectName?: string;
  catalogPath: string;
}

export interface PackageNodeAttrs {
  name: string;
  /** Version range or resolved version from Nx createPackageJson / externalNodes. */
  version?: string;
}

export interface PatchNodeAttrs {
  path: string;
  fileName: string;
  packageName: string;
  packageVersion?: string;
}

export interface ConceptNodeAttrs {
  title: string;
  docPath: string;
  sectionAnchor?: string;
  domain?: string;
}

export type KnowledgeNodeAttrs =
  | ProjectNodeAttrs
  | ClusterNodeAttrs
  | FileNodeAttrs
  | ApiNodeAttrs
  | WebhookEventNodeAttrs
  | PackageNodeAttrs
  | PatchNodeAttrs
  | ConceptNodeAttrs;

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

/** Non-Nx tool directory under tools/ (e.g. tools/ci). */
export function toolNodeId(dirName: string): string {
  return `tool:${dirName}`;
}

export function packageNodeId(packageName: string): string {
  return `package:${packageName}`;
}

export function patchNodeId(fileName: string): string {
  return `patch:${fileName}`;
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
  return type === 'app' || type === 'lib' || type === 'tool';
}

/** True when an Nx project root lives under workspace tools/. */
export function isToolsProjectRoot(root: string): boolean {
  const normalized = root.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === 'tools' || normalized.startsWith('tools/');
}

export type FileDerivedNodeType =
  | 'controller'
  | 'gateway'
  | 'job'
  | 'service'
  | 'repository'
  | 'entity'
  | 'dto'
  | 'guard'
  | 'module'
  | 'state'
  | 'provider'
  | 'email'
  | 'doc'
  | 'readme'
  | 'openapi'
  | 'asyncapi'
  | 'diagram';

const TS_SOURCE_TYPE_PRIORITY: Array<{ pattern: RegExp; type: FileDerivedNodeType }> = [
  { pattern: /\.job-handler\.ts$/i, type: 'job' },
  { pattern: /\.controller\.ts$/i, type: 'controller' },
  { pattern: /controller\./i, type: 'controller' },
  { pattern: /\.gateway\.ts$/i, type: 'gateway' },
  { pattern: /\.repository\.ts$/i, type: 'repository' },
  { pattern: /\.entity\.ts$/i, type: 'entity' },
  { pattern: /\.dto\.ts$/i, type: 'dto' },
  { pattern: /\.guard\.ts$/i, type: 'guard' },
  { pattern: /\.module\.ts$/i, type: 'module' },
  { pattern: /\.service\.ts$/i, type: 'service' },
];

/**
 * Domain strategy providers (payment processors, cloud/agent/pipeline adapters).
 * Excludes Angular/Nest DI `*.providers.ts` and frontend `*.provider.ts` helpers.
 */
export function isDomainProviderSource(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? '';
  const lower = base.toLowerCase();
  if (normalized.includes('/frontend/')) {
    return false;
  }
  if (lower.endsWith('.providers.ts')) {
    return false;
  }
  if (lower.endsWith('.provider.ts')) {
    return true;
  }
  if (lower.endsWith('.processor.ts') && /\/(payment-)?processors?\//i.test(normalized)) {
    return true;
  }
  return false;
}

/** Outbound notification / webhook event catalog (`*notification.events.ts`). */
export function isWebhookEventsCatalogFile(fileNameOrPath: string): boolean {
  const base = fileNameOrPath.replace(/\\/g, '/').split('/').pop() ?? fileNameOrPath;
  return /notification\.events\.ts$/i.test(base) && !base.toLowerCase().endsWith('.spec.ts');
}

/** Email body templates (`*.template.html` / `*.template.txt`), excluding partials and PDF. */
export function isEmailTemplateFile(fileNameOrPath: string): boolean {
  const base = fileNameOrPath.replace(/\\/g, '/').split('/').pop() ?? fileNameOrPath;
  const lower = base.toLowerCase();
  if (lower.includes('.partial.')) {
    return false;
  }
  if (lower.includes('-pdf.template.') || lower.includes('.pdf.template.')) {
    return false;
  }
  return lower.endsWith('.template.html') || lower.endsWith('.template.txt');
}

export function emailTemplateStem(fileName: string): string | null {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const match = /^(.+)\.template\.(html|txt)$/i.exec(base);
  if (!match) {
    return null;
  }
  const stem = match[1];
  if (/partial$/i.test(stem) || /-pdf$/i.test(stem)) {
    return null;
  }
  return stem;
}

/**
 * Classify a TypeScript basename into a dedicated source node type.
 * Returns `null` when no dedicated rule matches (not indexed).
 * Prefer {@link classifyTsSourceTypeFromPath} when a full relative path is available.
 */
export function classifyTsSourceType(fileName: string): FileDerivedNodeType | null {
  return classifyTsSourceTypeFromPath(fileName);
}

/** Path-aware TS classification (needed for domain `provider` heuristics). */
export function classifyTsSourceTypeFromPath(relativePath: string): FileDerivedNodeType | null {
  const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath;
  if (base.endsWith('.spec.ts') || base.endsWith('.d.ts')) {
    return null;
  }
  if (isDomainProviderSource(relativePath)) {
    return 'provider';
  }
  for (const { pattern, type } of TS_SOURCE_TYPE_PRIORITY) {
    if (pattern.test(base)) {
      return type;
    }
  }
  return null;
}

/** Whether a path should be indexed as a TS architectural source file. */
export function isIndexedTsSourceFile(fileNameOrPath: string): boolean {
  const base = fileNameOrPath.replace(/\\/g, '/').split('/').pop() ?? fileNameOrPath;
  const lower = base.toLowerCase();
  if (!lower.endsWith('.ts') || lower.endsWith('.spec.ts') || lower.endsWith('.d.ts')) {
    return false;
  }
  if (isWebhookEventsCatalogFile(fileNameOrPath)) {
    return true;
  }
  return classifyTsSourceTypeFromPath(fileNameOrPath) !== null;
}

/**
 * Map discovered file kind (and path for markdown / TS) to a knowledge-graph node type.
 * Prefer this over {@link fileNodeTypeFromKind} when a relative path is available.
 */
export function fileNodeTypeFromPath(kind: FileLanguageOrKind, relativePath = ''): FileDerivedNodeType {
  if (kind === 'openapi') {
    return 'openapi';
  }
  if (kind === 'asyncapi') {
    return 'asyncapi';
  }
  if (kind === 'mmd') {
    return 'diagram';
  }
  if (kind === 'template') {
    return 'email';
  }
  if (kind === 'md') {
    const normalized = relativePath.replace(/\\/g, '/');
    if (normalized === 'docs' || normalized.startsWith('docs/')) {
      return 'doc';
    }
    return 'readme';
  }
  if (kind === 'ts') {
    const typed = classifyTsSourceTypeFromPath(relativePath);
    if (!typed) {
      throw new Error(`Unclassified TypeScript source (not indexed): ${relativePath || '(empty path)'}`);
    }
    return typed;
  }
  const _exhaustive: never = kind;
  throw new Error(`Unsupported file kind: ${_exhaustive}`);
}

/** Map discovered file kind (and path for markdown) to a knowledge-graph node type. */
export function fileNodeTypeFromKind(kind: FileLanguageOrKind, relativePath = ''): FileDerivedNodeType {
  return fileNodeTypeFromPath(kind, relativePath);
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

export function webhookEventNodeId(projectName: string, eventName: string): string {
  return `webhook-event:${projectName}:${eventName}`;
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
