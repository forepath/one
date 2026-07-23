import * as fs from 'fs';

import { FileNodeAttrs, fileNodeId, KnowledgeEdge, KnowledgeNode } from './schema';
import {
  extractBalancedParenContents,
  extractExportedClassNames,
  resolveInjectableTarget,
  SourceFileRef,
} from './link-injects';

const MODULE_DECORATOR_RE = /@Module\s*\(/;
const ARRAY_PROP_RE = /\b(controllers|providers|exports)\s*:\s*\[/g;

const SKIP_IDENTIFIERS = new Set([
  'Module',
  'TypeOrmModule',
  'ConfigModule',
  'forwardRef',
  'provide',
  'useFactory',
  'useClass',
  'useValue',
  'useExisting',
  'inject',
  'imports',
  'controllers',
  'providers',
  'exports',
  'scope',
  'multi',
  'true',
  'false',
]);

const PROVIDABLE_TYPES = new Set([
  'controller',
  'gateway',
  'service',
  'repository',
  'guard',
  'provider',
  'job',
  'module',
]);

/**
 * Extract PascalCase identifiers from a Nest `@Module` controllers/providers/exports array body.
 */
export function extractModuleArrayIdentifiers(arrayBody: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(arrayBody)) !== null) {
    const name = match[1];
    if (!name || SKIP_IDENTIFIERS.has(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Extract provided class names from Nest `@Module({ controllers, providers, exports })`.
 */
export function extractModuleProvidedClassNames(source: string): string[] {
  const moduleIdx = source.search(MODULE_DECORATOR_RE);
  if (moduleIdx < 0) {
    return [];
  }
  const openIdx = source.indexOf('(', moduleIdx);
  const body = extractBalancedParenContents(source, openIdx);
  if (!body) {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();
  const propRe = new RegExp(ARRAY_PROP_RE.source, ARRAY_PROP_RE.flags);
  let propMatch: RegExpExecArray | null;
  while ((propMatch = propRe.exec(body)) !== null) {
    const bracketIdx = body.indexOf('[', propMatch.index);
    if (bracketIdx < 0) {
      continue;
    }
    const arrayBody = extractBalancedBracketContents(body, bracketIdx);
    if (!arrayBody) {
      continue;
    }
    for (const name of extractModuleArrayIdentifiers(arrayBody)) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function extractBalancedBracketContents(source: string, openIndex: number): string | null {
  if (openIndex < 0 || openIndex >= source.length || source[openIndex] !== '[') {
    return null;
  }
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, i);
      }
    }
  }
  return null;
}

export interface LinkModuleProvidesInput {
  moduleFiles: SourceFileRef[];
  targetFiles: SourceFileRef[];
  nodes: KnowledgeNode[];
}

/**
 * Build `provides` edges from Nest modules to controllers/gateways/services/… listed in
 * `controllers` / `providers` / `exports` metadata.
 */
export function linkModuleProvides(input: LinkModuleProvidesInput): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const nodeByPath = new Map<string, KnowledgeNode>();
  for (const node of input.nodes) {
    if (!PROVIDABLE_TYPES.has(node.type)) {
      continue;
    }
    const attrs = node.attrs as FileNodeAttrs;
    if (attrs.path) {
      nodeByPath.set(attrs.path.replace(/\\/g, '/'), node);
    }
  }

  const byClassName = new Map<string, { nodeId: string; projectName?: string }[]>();
  for (const file of input.targetFiles) {
    const rel = file.relativePath.replace(/\\/g, '/');
    const node = nodeByPath.get(rel);
    if (!node) {
      continue;
    }
    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    const attrs = node.attrs as FileNodeAttrs;
    for (const className of extractExportedClassNames(source)) {
      const list = byClassName.get(className) ?? [];
      if (list.some((entry) => entry.nodeId === node.id)) {
        byClassName.set(className, list);
        continue;
      }
      list.push({ nodeId: node.id, projectName: attrs.projectName ?? file.projectName });
      byClassName.set(className, list);
    }
  }

  for (const file of input.moduleFiles) {
    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }

    const provided = extractModuleProvidedClassNames(source);
    if (provided.length === 0) {
      continue;
    }

    const fromId = fileNodeId(file.relativePath);
    for (const className of provided) {
      const toId = resolveInjectableTarget(className, file.projectName, byClassName);
      if (!toId || toId === fromId) {
        continue;
      }
      const key = `${fromId}->${toId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ from: fromId, to: toId, type: 'provides' });
    }
  }

  return edges;
}
