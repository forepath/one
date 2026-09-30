export type JsonObject = Record<string, unknown>;

export interface InheritedAdditiveEntry {
  path: string;
  keys?: string[];
  items?: unknown[];
}

export interface HeredityMetadata {
  lockedPaths: string[];
  inheritedAdditive: InheritedAdditiveEntry[];
}

export const FORBIDDEN_V1_ROOT_KEYS = [
  'provider',
  'permission',
  'agent',
  'plugin',
  'snapshot',
  'attachment',
  'tools',
  'autoshare',
  'mode',
] as const;

/** Top-level keys that replace entirely when a parent sets them (security / policy). */
export const REPLACE_LOCK_ROOT_KEYS = [
  'permissions',
  'enabled_providers',
  'disabled_providers',
  'model_allow',
  'model_deny',
  'experimental',
] as const;

/** Map keys whose entries deep-merge; parent entry names are locked. */
export const MAP_MERGE_ROOT_KEYS = ['providers', 'commands', 'agents', 'references'] as const;

/** Array keys that concatenate across layers. */
export const ARRAY_CONCAT_ROOT_KEYS = ['skills', 'instructions', 'plugins'] as const;

/** Scalar / object roots locked when parent defines them. */
export const SCALAR_LOCK_ROOT_KEYS = [
  'model',
  'small_model',
  'default_agent',
  'shell',
  'username',
  'share',
  'update',
  'snapshots',
  'subagent_depth',
  'worktree',
  'watcher',
  'warming',
  'compaction',
  'websearch',
  'media',
  'tool_output',
  'mcp',
] as const;

export const NETWORK_SECRET_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS'] as const;

export class OpencodeConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpencodeConfigValidationError';
  }
}
