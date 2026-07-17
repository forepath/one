import * as fs from 'fs';

import { ApiNodeAttrs, fileNodeId, KnowledgeEdge, KnowledgeNode, projectNodeId } from './schema';

const CONTROLLER_DECORATOR_RE =
  /@Controller\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`|\{\s*path\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`))/g;

export interface ControllerBinding {
  relativePath: string;
  projectName?: string;
  controllerPath: string;
}

/**
 * Extract NestJS @Controller path prefixes from TypeScript source.
 */
export function extractControllerPaths(source: string): string[] {
  const paths: string[] = [];
  const re = new RegExp(CONTROLLER_DECORATOR_RE.source, CONTROLLER_DECORATOR_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? '';
    const normalized = normalizeApiPath(raw);
    if (normalized) {
      paths.push(normalized);
    }
  }
  return paths;
}

export function normalizeApiPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function pathMatchesPrefix(apiPath: string, controllerPrefix: string): boolean {
  const path = normalizeApiPath(apiPath);
  const prefix = normalizeApiPath(controllerPrefix);
  if (prefix === '/') {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

export interface LinkImplementsInput {
  controllerFiles: Array<{ relativePath: string; absolutePath: string; projectName?: string }>;
  apiNodes: KnowledgeNode[];
}

/**
 * Build implements edges from Nest controllers to OpenAPI api nodes.
 */
export function linkImplements(input: LinkImplementsInput): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set<string>();

  const openApiNodes = input.apiNodes.filter((node) => {
    if (node.type !== 'endpoint') {
      return false;
    }
    const attrs = node.attrs as ApiNodeAttrs;
    return attrs.specKind === 'openapi' && typeof attrs.pathOrChannel === 'string';
  });

  for (const file of input.controllerFiles) {
    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }

    const prefixes = extractControllerPaths(source);
    if (prefixes.length === 0) {
      continue;
    }

    const fileId = fileNodeId(file.relativePath);
    const projectId = file.projectName ? projectNodeId(file.projectName) : undefined;

    for (const prefix of prefixes) {
      for (const apiNode of openApiNodes) {
        const attrs = apiNode.attrs as ApiNodeAttrs;
        if (!pathMatchesPrefix(attrs.pathOrChannel, prefix)) {
          continue;
        }

        const fileEdgeKey = `${fileId}->${apiNode.id}`;
        if (!seen.has(fileEdgeKey)) {
          seen.add(fileEdgeKey);
          edges.push({ from: fileId, to: apiNode.id, type: 'implements' });
        }

        if (projectId) {
          const projectEdgeKey = `${projectId}->${apiNode.id}`;
          if (!seen.has(projectEdgeKey)) {
            seen.add(projectEdgeKey);
            edges.push({ from: projectId, to: apiNode.id, type: 'implements' });
          }
        }
      }
    }
  }

  return edges;
}
