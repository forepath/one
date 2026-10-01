/**
 * Explicit layer locks (Global / Workspace): JSON Pointer–style paths that lower layers
 * may not write, even when the parent left the value unset.
 *
 * Tab locks use `/tabs/{tabId}` and expand to the owned field/list pointers below.
 */

export const AGENT_CONFIG_TAB_IDS = [
  'general',
  'models',
  'providers',
  'mcp',
  'skills',
  'commands',
  'agents',
  'references',
  'permissions',
  'websearch',
  'compaction',
  'formatters',
  'warming',
  'tool_output',
  'overrides',
] as const;

export type AgentConfigTabId = (typeof AGENT_CONFIG_TAB_IDS)[number];

/** Paths owned by each structured editor tab (expanded when `/tabs/{id}` is locked). */
export const AGENT_CONFIG_TAB_LOCK_PATHS: Record<AgentConfigTabId, readonly string[]> = {
  general: [
    '/model',
    '/small_model',
    '/default_agent',
    '/shell',
    '/username',
    '/share',
    '/update',
    '/snapshots',
    '/subagent_depth',
    '/worktree',
    '/watcher',
    '/theme',
    '/keybinds',
    '/tui',
    '/server',
  ],
  models: ['/enabled_providers', '/disabled_providers', '/model_allow', '/model_deny'],
  providers: ['/providers'],
  mcp: ['/mcp', '/mcp/timeout', '/mcp/servers', '/mcp_allow', '/mcp_deny'],
  skills: ['/skills', '/instructions'],
  commands: ['/commands', '/plugins'],
  agents: ['/agents'],
  references: ['/references'],
  permissions: ['/permissions', '/experimental', '/experimental/policies', '/tool_output'],
  websearch: [
    '/websearch',
    '/secrets/HTTP_PROXY',
    '/secrets/HTTPS_PROXY',
    '/secrets/NO_PROXY',
    '/secrets/NODE_EXTRA_CA_CERTS',
  ],
  compaction: ['/compaction'],
  formatters: ['/formatter', '/media'],
  warming: ['/warming'],
  tool_output: ['/tool_output'],
  overrides: ['/overrides'],
};

const TAB_LOCK_PREFIX = '/tabs/';

function normalizePointer(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Expand explicit lock pointers: `/tabs/{id}` → owned field/list paths; other pointers pass through.
 * Deduplicates and sorts.
 */
export function expandExplicitLocks(locks: readonly string[] | null | undefined): string[] {
  if (!locks?.length) {
    return [];
  }

  const expanded = new Set<string>();

  for (const raw of locks) {
    if (typeof raw !== 'string' || !raw.trim()) {
      continue;
    }

    const pointer = normalizePointer(raw.trim());

    if (pointer.startsWith(TAB_LOCK_PREFIX)) {
      const tabId = pointer.slice(TAB_LOCK_PREFIX.length) as AgentConfigTabId;

      if ((AGENT_CONFIG_TAB_IDS as readonly string[]).includes(tabId)) {
        expanded.add(pointer);

        for (const owned of AGENT_CONFIG_TAB_LOCK_PATHS[tabId]) {
          expanded.add(owned);
        }

        continue;
      }
    }

    expanded.add(pointer);
  }

  return [...expanded].sort();
}

export function isTabLockPointer(pointer: string): boolean {
  return normalizePointer(pointer).startsWith(TAB_LOCK_PREFIX);
}

export function tabLockPointer(tabId: AgentConfigTabId | string): string {
  return `${TAB_LOCK_PREFIX}${tabId}`;
}

export function parseTabIdFromLock(pointer: string): AgentConfigTabId | null {
  const normalized = normalizePointer(pointer);

  if (!normalized.startsWith(TAB_LOCK_PREFIX)) {
    return null;
  }

  const tabId = normalized.slice(TAB_LOCK_PREFIX.length);

  return (AGENT_CONFIG_TAB_IDS as readonly string[]).includes(tabId) ? (tabId as AgentConfigTabId) : null;
}

/** Normalize and dedupe a layer's stored locks list (does not expand tab locks). */
export function normalizeStoredLocks(locks: readonly string[] | null | undefined): string[] {
  if (!locks?.length) {
    return [];
  }

  const out = new Set<string>();

  for (const raw of locks) {
    if (typeof raw !== 'string' || !raw.trim()) {
      continue;
    }

    out.add(normalizePointer(raw.trim()));
  }

  return [...out].sort();
}
