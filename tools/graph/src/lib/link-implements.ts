import * as fs from 'fs';

import { ApiNodeAttrs, fileNodeId, KnowledgeEdge, KnowledgeNode, projectNodeId } from './schema';
import { extractBalancedParenContents } from './link-injects';

const CONTROLLER_DECORATOR_RE =
  /@Controller\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`|\{\s*path\s*:\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`))/g;

const SUBSCRIBE_MESSAGE_RE = /@SubscribeMessage\s*\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)\s*\)/g;

const NAMESPACE_LITERAL_RE =
  /namespace\s*:\s*(?:process\.env\.\w+\s*(?:\?\?|\|\|)\s*)?(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/;

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

export interface GatewayBinding {
  /** Resolved WebSocket namespaces (literals / env fallbacks). */
  namespaces: string[];
  /** @SubscribeMessage event names. */
  events: string[];
  /** Filename stem without `.gateway.ts`, normalized. */
  stem?: string;
}

/**
 * Extract WebSocket namespace / SubscribeMessage bindings from a Nest gateway source file.
 */
export function extractGatewayBinding(source: string, relativePath?: string): GatewayBinding {
  const namespaces = new Set<string>();
  const events = new Set<string>();

  const gatewayIdx = source.search(/@WebSocketGateway\s*\(/);
  if (gatewayIdx >= 0) {
    const openIdx = source.indexOf('(', gatewayIdx);
    const args = extractBalancedParenContents(source, openIdx);
    if (args) {
      const nsRe = new RegExp(NAMESPACE_LITERAL_RE.source, 'g');
      let nsMatch: RegExpExecArray | null;
      while ((nsMatch = nsRe.exec(args)) !== null) {
        const raw = nsMatch[1] ?? nsMatch[2] ?? nsMatch[3] ?? '';
        const normalized = normalizeChannelToken(raw);
        if (normalized) {
          namespaces.add(normalized);
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
      events.add(normalized);
    }
  }

  let stem: string | undefined;
  if (relativePath) {
    const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? '';
    const rawStem = base.replace(/\.gateway\.ts$/i, '');
    if (rawStem) {
      stem = normalizeChannelToken(rawStem);
    }
  }

  return { namespaces: [...namespaces], events: [...events], stem };
}

/**
 * @deprecated Prefer {@link extractGatewayBinding}. Returns flat hint tokens for legacy callers/tests.
 */
export function extractGatewayChannelHints(source: string): string[] {
  const binding = extractGatewayBinding(source);
  return [...binding.namespaces, ...binding.events];
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
 * Match AsyncAPI channel names to gateway namespace + event bindings.
 * Prefer namespace-scoped matches to avoid cross-gateway SubscribeMessage collisions
 * (e.g. `setClient` on clients vs pages vs tickets).
 */
export function channelMatchesGateway(channelName: string, binding: GatewayBinding): boolean {
  const channel = normalizeChannelToken(channelName);
  if (!channel) {
    return false;
  }

  if (binding.namespaces.length > 0) {
    for (const ns of binding.namespaces) {
      if (!channelBelongsToNamespace(channel, ns)) {
        continue;
      }
      if (binding.events.length === 0) {
        return true;
      }
      const lastSegment = channel.includes('/') ? channel.slice(channel.lastIndexOf('/') + 1) : channel;
      if (binding.events.includes(lastSegment) || binding.events.includes(channel)) {
        return true;
      }
      // Namespace-owned channel (e.g. clients/error) even when not a SubscribeMessage handler.
      return true;
    }
    return false;
  }

  // No namespace: match events only as exact channel or */event, not bare substring across namespaces.
  for (const event of binding.events) {
    if (channel === event || channel.endsWith(`/${event}`)) {
      return true;
    }
  }

  if (binding.stem) {
    return channelMatchesStem(channel, binding.stem);
  }
  return false;
}

export function channelBelongsToNamespace(channelName: string, namespace: string): boolean {
  const channel = normalizeChannelToken(channelName);
  const ns = normalizeChannelToken(namespace);
  if (!channel || !ns) {
    return false;
  }
  return channel === ns || channel.startsWith(`${ns}/`);
}

export function channelMatchesStem(channelName: string, stem: string): boolean {
  const channel = normalizeChannelToken(channelName);
  const token = normalizeChannelToken(stem);
  if (!channel || !token) {
    return false;
  }
  if (channel === token) {
    return true;
  }
  const channelFlat = channel.replace(/\//g, '-');
  const tokenFlat = token.replace(/\//g, '-');
  return channelFlat === tokenFlat || channel.startsWith(`${token}/`) || channelFlat.startsWith(`${tokenFlat}-`);
}

/**
 * @deprecated Prefer {@link channelMatchesGateway}.
 */
export function channelMatchesHint(channelName: string, hint: string): boolean {
  return channelMatchesGateway(channelName, { namespaces: [], events: [], stem: hint });
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
 * and from Nest gateways to AsyncAPI channels.
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
    if (node.type !== 'channel') {
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

    const binding = extractGatewayBinding(source, file.relativePath);
    if (binding.namespaces.length === 0 && binding.events.length === 0 && !binding.stem) {
      continue;
    }

    const fileId = fileNodeId(file.relativePath);
    const projectId = file.projectName ? projectNodeId(file.projectName) : undefined;

    for (const apiNode of asyncApiNodes) {
      const attrs = apiNode.attrs as ApiNodeAttrs;
      if (!channelMatchesGateway(attrs.pathOrChannel, binding)) {
        continue;
      }

      pushImplementsEdge(edges, seen, fileId, apiNode.id);
      if (projectId) {
        pushImplementsEdge(edges, seen, projectId, apiNode.id);
      }
    }
  }

  return edges;
}
