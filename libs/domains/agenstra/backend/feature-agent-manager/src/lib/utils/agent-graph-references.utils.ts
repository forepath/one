import { posix } from 'node:path';

import {
  AGENSTRA_WORKSPACE_MOUNT_ROOT,
  AGENT_GRAPH_LIMITS,
  type AgentGraphNodeType,
  type AgentGraphPromptDetail,
  type AgentGraphPromptReference,
  type AgentGraphReferenceKind,
} from '@forepath/agenstra/shared/util-opencode-config';

import type { ContextInjectionPayload } from '../types/context-injection.types';

import type { AgentGraphLayerData } from './agent-graph-builder.utils';
import { assignAgentGraphCommunities } from './agent-graph-builder.utils';
import { deriveAgentContextItems } from './agent-context-items.utils';

/**
 * Prompt reference graphs: which context a prompt had explicitly (attached), implicitly (available) and what the turn
 * actually read (used) or changed (modified). Only references are recorded, never content: ids, names and paths.
 */

/** Names of the implicitly loaded OpenCode configuration (no values: secrets / commands never leave the config). */
export interface AgentGraphImplicitContext {
  instructions: string[];
  skills: string[];
  mcpServers: string[];
  commands: string[];
  agents: string[];
  plugins: string[];
  capturedAt: string;
}

const MAX_IMPLICIT_ENTRIES = 100;
const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

function names(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const name = record['name'] ?? record['path'] ?? record['id'];

          return typeof name === 'string' ? name : undefined;
        }

        return undefined;
      })
      .filter((entry): entry is string => !!entry && entry.length <= 300)
      .slice(0, MAX_IMPLICIT_ENTRIES);
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(
        ([, entry]) => !(entry && typeof entry === 'object' && (entry as Record<string, unknown>)['disabled'] === true),
      )
      .map(([key]) => key)
      .slice(0, MAX_IMPLICIT_ENTRIES);
  }

  return [];
}

/** Summarize an effective OpenCode configuration (v2 layered keys and OpenCode wire keys) by names only. */
export function summarizeAgentGraphImplicitContext(
  effective: Record<string, unknown>,
  capturedAt = new Date(),
): AgentGraphImplicitContext {
  return {
    instructions: names(effective['instructions']),
    skills: names(effective['skills']),
    mcpServers: names(effective['mcp'] ?? effective['mcp_servers']),
    commands: names(effective['commands'] ?? effective['command']),
    agents: names(effective['agents'] ?? effective['agent']),
    plugins: names(effective['plugins'] ?? effective['plugin']),
    capturedAt: capturedAt.toISOString(),
  };
}

function reference(
  kind: AgentGraphReferenceKind,
  type: AgentGraphNodeType,
  ref: string,
  label: string,
  extra: Partial<AgentGraphPromptReference> = {},
): AgentGraphPromptReference {
  return { kind, type, ref, label: label.slice(0, 200), ...extra };
}

/** Explicitly attached context of a prompt (context injection). */
export function attachedAgentGraphReferences(
  contextInjection: ContextInjectionPayload | undefined,
): AgentGraphPromptReference[] {
  if (!contextInjection) {
    return [];
  }

  const refs: AgentGraphPromptReference[] = [];
  const seen = new Set<string>();
  const add = (entry: AgentGraphPromptReference) => {
    if (!seen.has(entry.ref)) {
      seen.add(entry.ref);
      refs.push(entry);
    }
  };

  for (const item of deriveAgentContextItems(contextInjection)) {
    // Auto-enriched sections without a sha (`context`) have no stable element to point at.
    if (item.sha && item.kind !== 'context') {
      add(reference('attached', item.kind, `${item.kind}:${item.sha}`, item.title));
    }
  }

  const shaLists: [AgentGraphNodeType, string[] | undefined][] = [
    ['ticket', contextInjection.ticketShas],
    ['knowledge', contextInjection.knowledgeShas],
    ['plan', contextInjection.planShas],
  ];

  for (const [type, shas] of shaLists) {
    for (const sha of shas ?? []) {
      const normalized = typeof sha === 'string' ? sha.trim().toLowerCase() : '';

      if (SHA_PATTERN.test(normalized)) {
        add(reference('attached', type, `${type}:${normalized}`, `${type} ${normalized.slice(0, 8)}`));
      }
    }
  }

  for (const attachment of contextInjection.attachmentContexts ?? []) {
    add(
      reference('attached', 'attachment', `attachment:${attachment.id}`, attachment.fileName, {
        ...(attachment.agentPath ? { path: attachment.agentPath } : {}),
      }),
    );
  }

  for (const environmentId of contextInjection.environmentIds ?? []) {
    add(
      reference('attached', 'environment', `environment:${environmentId}`, `environment ${environmentId.slice(0, 8)}`),
    );
  }

  if (contextInjection.includeWorkspace) {
    add(
      reference('attached', 'mount', 'mount:workspace', AGENSTRA_WORKSPACE_MOUNT_ROOT, {
        path: AGENSTRA_WORKSPACE_MOUNT_ROOT,
      }),
    );
  }

  return refs;
}

/** Implicitly available context: loaded configuration plus instruction files found in the working directory. */
export function availableAgentGraphReferences(
  implicit: AgentGraphImplicitContext | null | undefined,
  instructionFiles: { path: string; label: string }[],
): AgentGraphPromptReference[] {
  const refs: AgentGraphPromptReference[] = [];

  for (const file of instructionFiles.slice(0, MAX_IMPLICIT_ENTRIES)) {
    refs.push(reference('available', 'instruction', `file:${file.path}`, file.label, { path: file.path }));
  }

  if (implicit) {
    implicit.instructions.forEach((entry) =>
      refs.push(reference('available', 'instruction', `instruction:${entry}`, entry, { path: entry })),
    );
    implicit.skills.forEach((entry) => refs.push(reference('available', 'skill', `skill:${entry}`, entry)));
    implicit.mcpServers.forEach((entry) =>
      refs.push(reference('available', 'mcp-server', `mcp-server:${entry}`, entry)),
    );
    implicit.commands.forEach((entry) => refs.push(reference('available', 'command', `command:${entry}`, entry)));
    implicit.agents.forEach((entry) =>
      refs.push(reference('available', 'agent-profile', `agent-profile:${entry}`, entry)),
    );
    implicit.plugins.forEach((entry) => refs.push(reference('available', 'plugin', `plugin:${entry}`, entry)));
  }

  return refs;
}

/** Map a path used by a tool to a reference id: relative inside the working directory, absolute otherwise. */
export function agentGraphPathReference(
  rawPath: string,
  workingDirectory: string,
): { ref: string; path: string } | undefined {
  if (typeof rawPath !== 'string') {
    return undefined;
  }

  const trimmed = rawPath.trim();

  if (!trimmed || trimmed.length > AGENT_GRAPH_LIMITS.idMaxLength || trimmed.includes('\0')) {
    return undefined;
  }

  const absolute =
    posix.normalize(trimmed.startsWith('/') ? trimmed : posix.join(workingDirectory, trimmed)).replace(/\/+$/, '') ||
    '/';

  if (absolute === workingDirectory) {
    return { ref: 'directory:.', path: '.' };
  }

  if (absolute.startsWith(`${workingDirectory}/`)) {
    const relative = absolute.slice(workingDirectory.length + 1);

    return { ref: `file:${relative}`, path: relative };
  }

  return { ref: `file:${absolute}`, path: absolute };
}

const READ_TOOLS = new Set(['read', 'view', 'cat']);
const WRITE_TOOLS = new Set(['edit', 'write', 'multiedit', 'create', 'str_replace', 'str_replace_editor']);
const PATCH_TOOLS = new Set(['patch', 'apply_patch']);
const SEARCH_TOOLS = new Set(['glob', 'grep', 'list', 'ls', 'codesearch', 'search']);
const CONTENT_REF_PATTERN = /^(ticket|knowledge|plan):([0-9a-f]{7,64})$/i;

function stringArg(args: unknown, ...keys: string[]): string | undefined {
  if (!args || typeof args !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    const value = (args as Record<string, unknown>)[key];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return undefined;
}

/** Paths named in an apply_patch / patch body (`*** Update File: x`, `--- a/x`, `+++ b/x`). */
function patchPaths(text: string): string[] {
  const paths = new Set<string>();

  for (const match of text.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) {
    paths.add(match[1].trim());
  }

  for (const match of text.matchAll(/^(?:\+\+\+|---) (?:[ab]\/)?(\S+)/gm)) {
    if (match[1] !== '/dev/null') {
      paths.add(match[1]);
    }
  }

  return [...paths].slice(0, 50);
}

/**
 * References of one tool call. Only names / paths / refs are kept: commands, patterns, URLs and contents are dropped
 * (they may carry secrets).
 */
export function toolCallAgentGraphReferences(
  toolName: string,
  args: unknown,
  options: { workingDirectory: string; mcpServers: readonly string[] },
): AgentGraphPromptReference[] {
  const name = toolName.trim().toLowerCase();

  if (!name || name === 'enrichment') {
    return [];
  }

  const refs: AgentGraphPromptReference[] = [reference('used', 'tool', `tool:${name}`, name, { tool: name })];
  const pathRef = (kind: AgentGraphReferenceKind, raw: string | undefined, type: AgentGraphNodeType = 'file') => {
    const mapped = raw ? agentGraphPathReference(raw, options.workingDirectory) : undefined;

    if (mapped) {
      const isDirectory = type === 'directory' || mapped.ref === 'directory:.';
      const ref = isDirectory && mapped.ref.startsWith('file:') ? `directory:${mapped.path}` : mapped.ref;

      refs.push(
        reference(kind, isDirectory ? 'directory' : 'file', ref, posix.basename(mapped.path) || mapped.path, {
          path: mapped.path,
          tool: name,
        }),
      );
    }
  };

  if (READ_TOOLS.has(name)) {
    pathRef('used', stringArg(args, 'filePath', 'file_path', 'path'));
  } else if (WRITE_TOOLS.has(name)) {
    pathRef('modified', stringArg(args, 'filePath', 'file_path', 'path'));
  } else if (PATCH_TOOLS.has(name)) {
    const body = stringArg(args, 'patchText', 'patch', 'input') ?? '';

    patchPaths(body).forEach((path) => pathRef('modified', path));
    pathRef('modified', stringArg(args, 'filePath', 'file_path'));
  } else if (SEARCH_TOOLS.has(name)) {
    pathRef('used', stringArg(args, 'path', 'directory', 'cwd') ?? options.workingDirectory, 'directory');
  } else if (name === 'skill') {
    const skill = stringArg(args, 'name', 'skill');

    if (skill) {
      refs.push(reference('used', 'skill', `skill:${skill}`, skill, { tool: name }));
    }
  } else if (name === 'task') {
    const agent = stringArg(args, 'subagent_type', 'agent');

    if (agent) {
      refs.push(reference('used', 'agent-profile', `agent-profile:${agent}`, agent, { tool: name }));
    }
  } else if (name.startsWith('agenstra_')) {
    const ref = stringArg(args, 'ref', 'parentRef');
    const match = ref?.match(CONTENT_REF_PATTERN);

    if (match) {
      const type = match[1].toLowerCase() as AgentGraphNodeType;
      const kind: AgentGraphReferenceKind = name.startsWith('agenstra_content_') ? 'modified' : 'used';

      refs.push(
        reference(kind, type, `${type}:${match[2].toLowerCase()}`, `${type} ${match[2].slice(0, 8)}`, { tool: name }),
      );
    }

    if (name.startsWith('agenstra_graph_')) {
      pathRef('used', stringArg(args, 'path'));
    }
  } else {
    // `<server>_<tool>` of a configured MCP server.
    const server = options.mcpServers.find((candidate) => name.startsWith(`${candidate.toLowerCase()}_`));

    if (server) {
      refs.push(reference('used', 'mcp-server', `mcp-server:${server}`, server, { tool: name }));
    }
  }

  return refs;
}

/** Merge references by `kind|ref`, counting repetitions; bounded per prompt. */
export function mergeAgentGraphReferences(
  current: AgentGraphPromptReference[],
  additions: AgentGraphPromptReference[],
): AgentGraphPromptReference[] {
  const byKey = new Map(current.map((entry) => [`${entry.kind}|${entry.ref}`, entry]));

  for (const entry of additions) {
    const key = `${entry.kind}|${entry.ref}`;
    const existing = byKey.get(key);

    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
    } else if (byKey.size < AGENT_GRAPH_LIMITS.maxReferencesPerPrompt) {
      byKey.set(key, { ...entry });
    }
  }

  return [...byKey.values()];
}

export function countAgentGraphReferences(
  references: AgentGraphPromptReference[],
): Record<AgentGraphReferenceKind, number> {
  const counts: Record<AgentGraphReferenceKind, number> = { attached: 0, available: 0, used: 0, modified: 0 };

  for (const entry of references) {
    counts[entry.kind] += 1;
  }

  return counts;
}

/** References layer: sessions → prompts → referenced elements (edge type = reference kind). */
export function buildAgentGraphReferencesLayer(prompts: AgentGraphPromptDetail[]): AgentGraphLayerData {
  const nodes = new Map<string, AgentGraphLayerData['nodes'][number]>();
  const edges = new Map<string, AgentGraphLayerData['edges'][number]>();

  for (const prompt of prompts) {
    const promptId = `prompt:${prompt.id}`;

    nodes.set(promptId, {
      id: promptId,
      type: 'prompt',
      label: prompt.excerpt?.trim() || `Prompt ${prompt.startedAt}`,
      attrs: {
        origin: prompt.origin,
        startedAt: prompt.startedAt,
        ...(prompt.messageId ? { messageId: prompt.messageId } : {}),
      },
    });

    if (prompt.chatSessionId) {
      const sessionId = `session:${prompt.chatSessionId}`;

      if (!nodes.has(sessionId)) {
        nodes.set(sessionId, { id: sessionId, type: 'session', label: `Chat ${prompt.chatSessionId.slice(0, 8)}` });
      }

      edges.set(`contains|${sessionId}|${promptId}`, { from: sessionId, to: promptId, type: 'contains' });
    }

    for (const entry of prompt.references) {
      if (!nodes.has(entry.ref)) {
        nodes.set(entry.ref, {
          id: entry.ref,
          type: entry.type,
          label: entry.label,
          ...(entry.path ? { path: entry.path } : {}),
        });
      }

      const key = `${entry.kind}|${promptId}|${entry.ref}`;
      const existing = edges.get(key);

      if (existing) {
        existing.attrs = {
          ...(existing.attrs ?? {}),
          count: Number(existing.attrs?.['count'] ?? 1) + (entry.count ?? 1),
        };
      } else {
        edges.set(key, {
          from: promptId,
          to: entry.ref,
          type: entry.kind,
          ...(entry.count || entry.tool
            ? { attrs: { ...(entry.count ? { count: entry.count } : {}), ...(entry.tool ? { tool: entry.tool } : {}) } }
            : {}),
        });
      }
    }
  }

  const layer = { nodes: [...nodes.values()], edges: [...edges.values()] };

  assignAgentGraphCommunities(layer);

  return layer;
}

/** Mount ids of `/opt/workspace/<mount id>/...` paths (cross-environment references). */
export function referencedAgentGraphMountIds(paths: Iterable<string>): string[] {
  const ids = new Set<string>();
  const prefix = `${AGENSTRA_WORKSPACE_MOUNT_ROOT}/`;

  for (const path of paths) {
    if (path.startsWith(prefix)) {
      const mountId = path.slice(prefix.length).split('/')[0];

      if (mountId) {
        ids.add(mountId);
      }
    }
  }

  return [...ids];
}

/**
 * Prompt history outlives files: references to paths inside the working directory that the current graph no longer
 * contains are marked `missing` (the history itself stays). Absolute paths (other environments, outside the working
 * directory) cannot be checked here and are left as they are.
 */
export function markMissingAgentGraphReferenceTargets(
  layer: AgentGraphLayerData,
  existingIds: ReadonlySet<string>,
): AgentGraphLayerData {
  return {
    edges: layer.edges,
    nodes: layer.nodes.map((node) => {
      const local =
        (node.id.startsWith('file:') || node.id.startsWith('directory:')) &&
        !node.id.slice(node.id.indexOf(':') + 1).startsWith('/');

      return local && !existingIds.has(node.id) ? { ...node, attrs: { ...(node.attrs ?? {}), missing: true } } : node;
    }),
  };
}
