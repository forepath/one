import * as fs from 'fs';
import * as path from 'path';

import { ApiNodeAttrs, FileNodeAttrs, fileNodeId, httpApiNodeId, KnowledgeEdge, KnowledgeNode } from './schema';
import { SourceFileRef } from './link-injects';
import { normalizeApiPath } from './link-implements';

const HTTP_CALL_RE = /\.http\.(get|post|put|patch|delete)(?:\s*<[^>]*>)?\s*\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/gi;

const INJECT_SERVICE_RE = /\binject\s*(?:<[^>]*>)?\s*\(\s*([A-Z][A-Za-z0-9_]*)\s*\)/g;

export interface ExtractedHttpCall {
  method: string;
  path: string;
}

/**
 * Normalize an OpenAPI or frontend path to a comparable pattern (`{param}` placeholders).
 */
export function pathPatternKey(rawPath: string): string {
  const normalized = normalizeApiPath(rawPath);
  return normalized
    .split('/')
    .map((segment) => {
      if (!segment) {
        return segment;
      }
      if ((segment.startsWith('{') && segment.endsWith('}')) || segment.startsWith('${')) {
        return '{param}';
      }
      return segment;
    })
    .join('/');
}

/**
 * Turn a frontend URL template into an API path (strip `${apiUrl}`, map `${x}` → `{param}`).
 */
export function frontendUrlToApiPath(raw: string): string | null {
  let value = raw.trim();
  if (!value) {
    return null;
  }
  // Drop leading `${this.apiUrl}` / `${environment...}` style prefixes.
  value = value.replace(/^\$\{[^}]+\}/, '');
  value = value.replace(/\$\{[^}]+\}/g, '{param}');
  // Drop accidental encodeURIComponent wrappers left as plain text.
  value = value.replace(/encodeURIComponent\(([^)]+)\)/g, '{param}');
  if (!value.startsWith('/')) {
    // Relative path without leading slash (rare) — require it looks like a path segment.
    if (!/^[A-Za-z0-9_{}-]/.test(value)) {
      return null;
    }
    value = `/${value}`;
  }
  // Ignore pure root or empty.
  if (value === '/' || value === '') {
    return null;
  }
  return normalizeApiPath(value);
}

/**
 * Extract HTTP method + path pairs from Angular HttpClient call sites.
 */
export function extractHttpCalls(source: string): ExtractedHttpCall[] {
  const calls: ExtractedHttpCall[] = [];
  const seen = new Set<string>();
  const re = new RegExp(HTTP_CALL_RE.source, HTTP_CALL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const method = (match[1] ?? '').toUpperCase();
    const rawUrl = match[2] ?? match[3] ?? match[4] ?? '';
    const apiPath = frontendUrlToApiPath(rawUrl);
    if (!method || !apiPath) {
      continue;
    }
    const key = `${method}:${apiPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    calls.push({ method, path: apiPath });
  }
  return calls;
}

/** Extract `inject(FooService)` class tokens from Angular sources (facades/effects). */
export function extractInjectedClassTokens(source: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(INJECT_SERVICE_RE.source, INJECT_SERVICE_RE.flags);
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

export interface LinkHttpCallsInput {
  serviceFiles: SourceFileRef[];
  endpointNodes: KnowledgeNode[];
}

/**
 * Build `calls` edges from frontend HTTP services to OpenAPI endpoints.
 */
export function linkHttpCalls(input: LinkHttpCallsInput): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const endpointsByKey = new Map<string, string[]>();
  for (const node of input.endpointNodes) {
    if (node.type !== 'endpoint') {
      continue;
    }
    const attrs = node.attrs as ApiNodeAttrs;
    if (attrs.specKind !== 'openapi' || !attrs.method || !attrs.pathOrChannel) {
      continue;
    }
    const key = `${attrs.method.toUpperCase()}:${pathPatternKey(attrs.pathOrChannel)}`;
    const list = endpointsByKey.get(key) ?? [];
    list.push(node.id);
    endpointsByKey.set(key, list);
  }

  for (const file of input.serviceFiles) {
    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }
    if (!/HttpClient/.test(source) && !/\.http\.(get|post|put|patch|delete)/i.test(source)) {
      continue;
    }

    const fromId = fileNodeId(file.relativePath);
    for (const call of extractHttpCalls(source)) {
      const key = `${call.method}:${pathPatternKey(call.path)}`;
      const targets = endpointsByKey.get(key) ?? [];
      for (const toId of targets) {
        const edgeKey = `${fromId}->${toId}`;
        if (seen.has(edgeKey)) {
          continue;
        }
        seen.add(edgeKey);
        edges.push({ from: fromId, to: toId, type: 'calls' });
      }
    }
  }

  return edges;
}

export interface LinkStateFacadeInjectsInput {
  /** Absolute paths to state slice directories already represented as `state` nodes. */
  stateDirs: Array<{ relativePath: string; absolutePath: string; projectName?: string; memberFiles: string[] }>;
  serviceFiles: SourceFileRef[];
  nodes: KnowledgeNode[];
}

/**
 * Build `injects` edges from NgRx `state` nodes to services referenced via `inject(...)` in
 * slice facades (and other slice members).
 */
export function linkStateFacadeInjects(input: LinkStateFacadeInjectsInput): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const byClassName = new Map<string, { nodeId: string; projectName?: string }[]>();
  const nodeByPath = new Map<string, KnowledgeNode>();
  for (const node of input.nodes) {
    if (node.type !== 'service') {
      continue;
    }
    const attrs = node.attrs as FileNodeAttrs;
    if (attrs.path) {
      nodeByPath.set(attrs.path.replace(/\\/g, '/'), node);
    }
  }

  for (const file of input.serviceFiles) {
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
    const classMatch = /\bexport\s+class\s+([A-Z][A-Za-z0-9_]*)\b/.exec(source);
    if (!classMatch) {
      continue;
    }
    const list = byClassName.get(classMatch[1]) ?? [];
    list.push({ nodeId: node.id, projectName: (node.attrs as FileNodeAttrs).projectName ?? file.projectName });
    byClassName.set(classMatch[1], list);
  }

  for (const stateDir of input.stateDirs) {
    const fromId = fileNodeId(stateDir.relativePath);
    const facadeFiles = stateDir.memberFiles.filter((name) => name.toLowerCase().endsWith('.facade.ts'));
    const scanFiles = facadeFiles.length > 0 ? facadeFiles : stateDir.memberFiles.filter((n) => n.endsWith('.ts'));

    for (const member of scanFiles) {
      const memberAbs = path.join(stateDir.absolutePath, member);
      let source: string;
      try {
        source = fs.readFileSync(memberAbs, 'utf8');
      } catch {
        continue;
      }

      for (const className of extractInjectedClassTokens(source)) {
        const candidates = byClassName.get(className) ?? [];
        let toId: string | undefined;
        if (stateDir.projectName) {
          const same = candidates.filter((c) => c.projectName === stateDir.projectName);
          if (same.length === 1) {
            toId = same[0].nodeId;
          } else if (same.length === 0 && candidates.length === 1) {
            toId = candidates[0].nodeId;
          }
        } else if (candidates.length === 1) {
          toId = candidates[0].nodeId;
        }
        if (!toId) {
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
  }

  return edges;
}

/** Test helper: stable endpoint id for pattern checks. */
export function endpointIdForCall(method: string, path: string): string {
  return httpApiNodeId(method, path);
}
