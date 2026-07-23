import * as fs from 'fs';

import * as yaml from 'js-yaml';

import { channelApiNodeId, fileNodeId, KnowledgeEdge, KnowledgeNode } from './schema';

export interface ParseAsyncApiResult {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

/**
 * Parse an AsyncAPI YAML/JSON document into channel nodes and contains edges.
 */
export function parseAsyncApi(relativePath: string, content: string): ParseAsyncApiResult {
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

  const channels = (doc as { channels?: Record<string, unknown> }).channels;
  if (!channels || typeof channels !== 'object') {
    return { nodes, edges };
  }

  for (const [channelName, channelValue] of Object.entries(channels)) {
    let operationId: string | undefined;
    let summary: string | undefined;

    if (channelValue && typeof channelValue === 'object') {
      const channel = channelValue as {
        description?: string;
        publish?: { operationId?: string; summary?: string };
        subscribe?: { operationId?: string; summary?: string };
      };
      summary = typeof channel.description === 'string' ? channel.description : undefined;
      const publish = channel.publish;
      const subscribe = channel.subscribe;
      if (publish && typeof publish.operationId === 'string') {
        operationId = publish.operationId;
      } else if (subscribe && typeof subscribe.operationId === 'string') {
        operationId = subscribe.operationId;
      }
      if (!summary) {
        summary =
          (publish && typeof publish.summary === 'string' && publish.summary) ||
          (subscribe && typeof subscribe.summary === 'string' && subscribe.summary) ||
          undefined;
      }
    }

    const apiId = channelApiNodeId(channelName);
    nodes.push({
      id: apiId,
      type: 'channel',
      attrs: {
        pathOrChannel: channelName,
        operationId,
        summary,
        specKind: 'asyncapi',
      },
    });
    edges.push({ from: fileId, to: apiId, type: 'contains' });
  }

  return { nodes, edges };
}

export function parseAsyncApiFile(relativePath: string, absolutePath: string): ParseAsyncApiResult {
  const content = fs.readFileSync(absolutePath, 'utf8');
  return parseAsyncApi(relativePath, content);
}
