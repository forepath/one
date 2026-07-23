import * as fs from 'fs';

import { FileNodeAttrs, fileNodeId, KnowledgeEdge, KnowledgeNode } from './schema';

/** Nest architectural nodes that commonly appear as constructor DI targets. */
const INJECTABLE_TARGET_TYPES = new Set(['service', 'repository', 'guard', 'provider', 'job', 'controller', 'gateway']);

/** Nest entrypoints / services whose constructor deps are highest value to map. */
export const INJECTOR_SOURCE_TYPES = new Set(['controller', 'gateway', 'service', 'job', 'provider']);

const EXPORT_CLASS_RE = /\bexport\s+class\s+([A-Z][A-Za-z0-9_]*)\b/g;
const CONSTRUCTOR_RE = /\bconstructor\s*\(/;
const PARAM_TYPE_RE = /:\s*([A-Z][A-Za-z0-9_]*)\b/g;

export interface SourceFileRef {
  relativePath: string;
  absolutePath: string;
  projectName?: string;
}

interface InjectableTarget {
  nodeId: string;
  projectName?: string;
}

/**
 * Extract the interior of a balanced `(...)` starting at `openIndex` (the `(`).
 * Returns null when the paren is unmatched.
 */
export function extractBalancedParenContents(source: string, openIndex: number): string | null {
  if (openIndex < 0 || openIndex >= source.length || source[openIndex] !== '(') {
    return null;
  }

  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }
  return null;
}

/**
 * Extract PascalCase type names from Nest-style constructor parameter lists.
 * Ignores unmatched constructors and does not resolve `@Inject(...)` tokens.
 */
export function extractConstructorInjectedTypes(source: string): string[] {
  const match = CONSTRUCTOR_RE.exec(source);
  if (!match || match.index === undefined) {
    return [];
  }

  const openIndex = source.indexOf('(', match.index);
  const params = extractBalancedParenContents(source, openIndex);
  if (!params) {
    return [];
  }

  const types: string[] = [];
  const seen = new Set<string>();
  const typeRe = new RegExp(PARAM_TYPE_RE.source, PARAM_TYPE_RE.flags);
  let typeMatch: RegExpExecArray | null;
  while ((typeMatch = typeRe.exec(params)) !== null) {
    const typeName = typeMatch[1];
    if (!typeName || seen.has(typeName)) {
      continue;
    }
    seen.add(typeName);
    types.push(typeName);
  }
  return types;
}

/** Extract exported class names from a TypeScript source file. */
export function extractExportedClassNames(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(EXPORT_CLASS_RE.source, EXPORT_CLASS_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const name = match[1];
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Prefer a same-project injectable; otherwise a globally unique class name match.
 * Duplicate entries for the same node id are ignored.
 */
export function resolveInjectableTarget(
  typeName: string,
  injectorProjectName: string | undefined,
  byClassName: Map<string, InjectableTarget[]>,
): string | undefined {
  const raw = byClassName.get(typeName);
  if (!raw || raw.length === 0) {
    return undefined;
  }

  const deduped: InjectableTarget[] = [];
  const seenIds = new Set<string>();
  for (const candidate of raw) {
    if (seenIds.has(candidate.nodeId)) {
      continue;
    }
    seenIds.add(candidate.nodeId);
    deduped.push(candidate);
  }

  if (injectorProjectName) {
    const sameProject = deduped.filter((c) => c.projectName === injectorProjectName);
    if (sameProject.length === 1) {
      return sameProject[0].nodeId;
    }
    if (sameProject.length > 1) {
      return undefined;
    }
  }

  if (deduped.length === 1) {
    return deduped[0].nodeId;
  }
  return undefined;
}

export interface LinkInjectsInput {
  /** Controllers / gateways to scan for constructor DI. */
  injectorFiles: SourceFileRef[];
  /** Candidate injectable files already present as graph nodes. */
  targetFiles: SourceFileRef[];
  /** Graph nodes (used to keep only architectural injectable types). */
  nodes: KnowledgeNode[];
}

/**
 * Build `injects` edges from Nest controllers/gateways/services to constructor-injected
 * architectural nodes (services, repositories, guards, providers, …).
 */
export function linkInjects(input: LinkInjectsInput): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const injectableNodeIds = new Set(input.nodes.filter((n) => INJECTABLE_TARGET_TYPES.has(n.type)).map((n) => n.id));
  const nodeByPath = new Map<string, KnowledgeNode>();
  for (const node of input.nodes) {
    if (!INJECTABLE_TARGET_TYPES.has(node.type)) {
      continue;
    }
    const attrs = node.attrs as FileNodeAttrs;
    if (attrs.path) {
      nodeByPath.set(attrs.path.replace(/\\/g, '/'), node);
    }
  }

  const byClassName = new Map<string, InjectableTarget[]>();
  for (const file of input.targetFiles) {
    const rel = file.relativePath.replace(/\\/g, '/');
    const node = nodeByPath.get(rel);
    if (!node || !injectableNodeIds.has(node.id)) {
      continue;
    }

    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }

    const classNames = extractExportedClassNames(source);
    const attrs = node.attrs as FileNodeAttrs;
    for (const className of classNames) {
      const list = byClassName.get(className) ?? [];
      list.push({ nodeId: node.id, projectName: attrs.projectName ?? file.projectName });
      byClassName.set(className, list);
    }
  }

  for (const file of input.injectorFiles) {
    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }

    const injectedTypes = extractConstructorInjectedTypes(source);
    if (injectedTypes.length === 0) {
      continue;
    }

    const fromId = fileNodeId(file.relativePath);
    for (const typeName of injectedTypes) {
      const toId = resolveInjectableTarget(typeName, file.projectName, byClassName);
      if (!toId || toId === fromId) {
        continue;
      }
      const key = `${fromId}->${toId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ from: fromId, to: toId, type: 'injects' });
    }
  }

  return edges;
}
