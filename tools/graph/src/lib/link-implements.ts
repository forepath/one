import * as fs from 'fs';

import { ApiNodeAttrs, fileNodeId, KnowledgeEdge, KnowledgeNode, projectNodeId } from './schema';

const CONTROLLER_DECORATOR_RE =
  /@Controller\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`|\{\s*path\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`))/g;

const WEBSOCKET_GATEWAY_RE =
  /@WebSocketGateway\s*\(\s*(?:(\d+)\s*,\s*)?\{([^}]*)\}|@WebSocketGateway\s*\(\s*\{([^}]*)\}\s*\)|@WebSocketGateway\s*\(\s*(\d+)\s*\)/g;

const NAMESPACE_IN_OPTIONS_RE = /namespace\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/;

const SUBSCRIBE_MESSAGE_RE = /@SubscribeMessage\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*\)/g;

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

/**
 * Extract WebSocket namespace / channel tokens from a Nest gateway source file.
 */
export function extractGatewayChannelHints(source: string): string[] {
  const hints = new Set<string>();

  const gatewayRe = new RegExp(WEBSOCKET_GATEWAY_RE.source, WEBSOCKET_GATEWAY_RE.flags);
  let gatewayMatch: RegExpExecArray | null;
  while ((gatewayMatch = gatewayRe.exec(source)) !== null) {
    const optionsBlock = gatewayMatch[2] ?? gatewayMatch[3] ?? '';
    if (optionsBlock) {
      const ns = NAMESPACE_IN_OPTIONS_RE.exec(optionsBlock);
      const raw = ns?.[1] ?? ns?.[2] ?? ns?.[3];
      if (raw) {
        const normalized = normalizeChannelToken(raw);
        if (normalized) {
          hints.add(normalized);
        }
      }
    }
  }

  const subscribeRe = new RegExp(SUBSCRIBE_MESSAGE_RE.source, SUBSCRIBE_MESSAGE_RE.flags);
  let subscribeMatch: RegExpExecArray | null;
  while ((subscribeMatch = subscribeRe.exec(source)) !== null) {
    const raw = subscribeMatch[1] ?? subscribeMatch[2] ?? subscribeMatch[3] ?? '';
    const normalized = normalizeChannelToken(raw);
    if (normalized) {
      hints.add(normalized);
    }
  }

  return [...hints];
}

export function normalizeApiPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '/';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function normalizeChannelToken(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

export function pathMatchesPrefix(apiPath: string, controllerPrefix: string): boolean {
  const path = normalizeApiPath(apiPath);
  const prefix = normalizeApiPath(controllerPrefix);
  if (prefix === '/') {
    return true;
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Match AsyncAPI channel names to gateway hints (namespace or SubscribeMessage).
 * Allows equality or either side containing the other as a path segment / suffix.
 */
export function channelMatchesHint(channelName: string, hint: string): boolean {
  const channel = normalizeChannelToken(channelName);
  const token = normalizeChannelToken(hint);
  if (!channel || !token) {
    return false;
  }
  if (channel === token) {
    return true;
  }
  if (channel.endsWith(`/${token}`) || channel.startsWith(`${token}/`)) {
    return true;
  }
  if (token.endsWith(`/${channel}`) || token.startsWith(`${channel}/`)) {
    return true;
  }
  // Filename-style: billing-status vs billing/status
  const channelFlat = channel.replace(/\//g, '-');
  const tokenFlat = token.replace(/\//g, '-');
  return channelFlat === tokenFlat || channelFlat.includes(tokenFlat) || tokenFlat.includes(channelFlat);
}

export interface SourceFileRef {
  relativePath: string;
  absolutePath: string;
  projectName?: string;
}

export interface LinkImplementsInput {
  controllerFiles: SourceFileRef[];
  gatewayFiles?: SourceFileRef[];
  apiNodes: KnowledgeNode[];
}

function pushImplementsEdge(edges: KnowledgeEdge[], seen: Set<string>, fromId: string, toId: string): void {
  const key = `${fromId}->${toId}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  edges.push({ from: fromId, to: toId, type: 'implements' });
}

/**
 * Build implements edges from Nest controllers to OpenAPI endpoints
 * and from Nest gateways to AsyncAPI channel endpoints.
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

  const asyncApiNodes = input.apiNodes.filter((node) => {
    if (node.type !== 'endpoint') {
      return false;
    }
    const attrs = node.attrs as ApiNodeAttrs;
    return attrs.specKind === 'asyncapi' && typeof attrs.pathOrChannel === 'string';
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

        pushImplementsEdge(edges, seen, fileId, apiNode.id);
        if (projectId) {
          pushImplementsEdge(edges, seen, projectId, apiNode.id);
        }
      }
    }
  }

  for (const file of input.gatewayFiles ?? []) {
    let source: string;
    try {
      source = fs.readFileSync(file.absolutePath, 'utf8');
    } catch {
      continue;
    }

    const hints = extractGatewayChannelHints(source);
    // Always include basename stem (e.g. billing-status from billing-status.gateway.ts)
    const base = file.relativePath.replace(/\\/g, '/').split('/').pop() ?? '';
    const stem = base.replace(/\.gateway\.ts$/i, '');
    if (stem) {
      hints.push(normalizeChannelToken(stem));
    }
    if (hints.length === 0) {
      continue;
    }

    const fileId = fileNodeId(file.relativePath);
    const projectId = file.projectName ? projectNodeId(file.projectName) : undefined;

    for (const hint of hints) {
      for (const apiNode of asyncApiNodes) {
        const attrs = apiNode.attrs as ApiNodeAttrs;
        if (!channelMatchesHint(attrs.pathOrChannel, hint)) {
          continue;
        }

        pushImplementsEdge(edges, seen, fileId, apiNode.id);
        if (projectId) {
          pushImplementsEdge(edges, seen, projectId, apiNode.id);
        }
      }
    }
  }

  return edges;
}
