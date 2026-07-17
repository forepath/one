import * as fs from 'fs';

import * as yaml from 'js-yaml';

import { fileNodeId, httpApiNodeId, KnowledgeEdge, KnowledgeNode } from './schema';

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

export interface ParseOpenApiResult {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

/**
 * Parse an OpenAPI YAML/JSON document into api nodes and contains edges.
 */
export function parseOpenApi(relativePath: string, content: string): ParseOpenApiResult {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const fileId = fileNodeId(relativePath);

  let doc: unknown;
  try {
    doc = yaml.load(content);
  } catch {
    return { nodes, edges };
  }

  if (!doc || typeof doc !== 'object') {
    return { nodes, edges };
  }

  const paths = (doc as { paths?: Record<string, Record<string, unknown>> }).paths;
  if (!paths || typeof paths !== 'object') {
    return { nodes, edges };
  }

  for (const [apiPath, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) {
        continue;
      }
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      const op = operation as { operationId?: string; summary?: string };
      const apiId = httpApiNodeId(method, apiPath);
      nodes.push({
        id: apiId,
        type: 'endpoint',
        attrs: {
          method: method.toUpperCase(),
          pathOrChannel: apiPath,
          operationId: typeof op.operationId === 'string' ? op.operationId : undefined,
          summary: typeof op.summary === 'string' ? op.summary : undefined,
          specKind: 'openapi',
        },
      });
      edges.push({ from: fileId, to: apiId, type: 'contains' });
    }
  }

  return { nodes, edges };
}

export function parseOpenApiFile(relativePath: string, absolutePath: string): ParseOpenApiResult {
  const content = fs.readFileSync(absolutePath, 'utf8');
  return parseOpenApi(relativePath, content);
}
