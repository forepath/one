import type { AgentGraphNode, AgentGraphQueryLayer } from '@forepath/agenstra/shared/util-opencode-config';

/** What redaction needs to know about the environment a calling agent reads. */
export interface AgentGraphRedactionTarget {
  self: boolean;
  workspacePeer: boolean;
  mountId?: string;
  environmentName?: string;
}

/** Controller content whose titles other environments only see as refs. */
export const AGENT_GRAPH_CONTROLLER_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'ticket',
  'knowledge',
  'plan',
  'attachment',
  'initiative',
  'artifact',
]);

/**
 * A node of another environment as a calling agent may see it:
 * - environments outside the caller's workspace stay anonymous in every layer: their name (environment root, and
 *   module labels that fell back to it) becomes the mount id;
 * - in the prompt reference layers, prompt excerpts and titles of controller content (tickets, knowledge, plans,
 *   attachments, initiatives and their documents) are replaced by their refs; the caller resolves them through `agenstra_context_*` under its own
 *   grants.
 */
export function redactAgentGraphNodeForCaller(
  node: AgentGraphNode,
  target: AgentGraphRedactionTarget,
  layer: AgentGraphQueryLayer,
): AgentGraphNode {
  if (target.self) {
    return node;
  }

  if (!target.workspacePeer) {
    const anonymous = target.mountId ?? 'environment';

    if (node.type === 'environment') {
      return { ...node, label: anonymous };
    }

    if (node.type === 'module' && target.environmentName && node.label === target.environmentName) {
      return { ...node, label: anonymous };
    }
  }

  if (layer === 'code' || layer === 'paths') {
    return node;
  }

  if (node.type === 'prompt') {
    return { ...node, label: `Prompt ${String(node.attrs?.['startedAt'] ?? '')}`.trim() };
  }

  if (AGENT_GRAPH_CONTROLLER_CONTENT_TYPES.has(node.type)) {
    return { ...node, label: node.id };
  }

  return node;
}
