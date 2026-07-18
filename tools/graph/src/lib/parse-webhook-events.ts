import * as fs from 'fs';

import { KnowledgeEdge, KnowledgeNode, WebhookEventNodeAttrs, projectNodeId, webhookEventNodeId } from './schema';

const EVENT_STRING_RE = /['"`]([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)['"`]/gi;

export interface ParseWebhookEventsResult {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  eventNames: string[];
}

/**
 * Extract outbound webhook / notification event names from a catalog source file
 * (typically `*.notification.events.ts`).
 */
export function extractWebhookEventNames(source: string): string[] {
  const names = new Set<string>();
  const re = new RegExp(EVENT_STRING_RE.source, EVENT_STRING_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const name = match[1]?.toLowerCase();
    if (name && name.includes('.')) {
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Parse a webhook events catalog into `webhook-event` nodes and `contains` edges.
 */
export function parseWebhookEventsCatalog(options: {
  relativePath: string;
  source: string;
  projectName?: string;
}): ParseWebhookEventsResult {
  const eventNames = extractWebhookEventNames(options.source);
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];

  if (!options.projectName) {
    return { nodes, edges, eventNames };
  }

  const projectId = projectNodeId(options.projectName);
  for (const eventName of eventNames) {
    const id = webhookEventNodeId(options.projectName, eventName);
    const attrs: WebhookEventNodeAttrs = {
      eventName,
      projectName: options.projectName,
      catalogPath: options.relativePath.replace(/\\/g, '/'),
    };
    nodes.push({ id, type: 'webhook-event', attrs });
    edges.push({ from: projectId, to: id, type: 'contains' });
  }

  return { nodes, edges, eventNames };
}

export function parseWebhookEventsCatalogFile(
  relativePath: string,
  absolutePath: string,
  projectName?: string,
): ParseWebhookEventsResult {
  let source: string;
  try {
    source = fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return { nodes: [], edges: [], eventNames: [] };
  }
  return parseWebhookEventsCatalog({ relativePath, source, projectName });
}
