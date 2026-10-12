import { stablePlatformPolicyJson } from '@forepath/agenstra/shared/util-opencode-config';

/** Root keys whose changes are security relevant (policy, allow / deny lists, egress, message filters). */
export const AGENT_CONFIG_SECURITY_ROOT_KEYS = [
  'permissions',
  'experimental',
  'egress',
  'message_filters',
  'enabled_providers',
  'disabled_providers',
  'model_allow',
  'model_deny',
  'mcp_allow',
  'mcp_deny',
] as const;

export interface AgentConfigLayerSnapshot {
  config?: Record<string, unknown> | null;
  overrides?: Record<string, unknown> | null;
  locks?: readonly string[] | null;
}

export interface AgentConfigChangeSummary {
  changedRoots: string[];
  securityRootsChanged: string[];
  locksChanged: boolean;
  secretKeysChanged: string[];
}

function rootValues(snapshot: AgentConfigLayerSnapshot, key: string): string {
  return stablePlatformPolicyJson([snapshot.config?.[key] ?? null, snapshot.overrides?.[key] ?? null]);
}

/**
 * Summarize what a layer PUT changed (root keys only — values are never reported, they may hold
 * internal hostnames or patterns). Secret keys are reported by name for keys present in the patch.
 */
export function summarizeAgentConfigChange(
  before: AgentConfigLayerSnapshot,
  after: AgentConfigLayerSnapshot,
  secretsPatch?: Record<string, string> | null,
): AgentConfigChangeSummary {
  const keys = new Set<string>([
    ...Object.keys(before.config ?? {}),
    ...Object.keys(before.overrides ?? {}),
    ...Object.keys(after.config ?? {}),
    ...Object.keys(after.overrides ?? {}),
  ]);
  const changedRoots = [...keys].filter((key) => rootValues(before, key) !== rootValues(after, key)).sort();
  const security = new Set<string>(AGENT_CONFIG_SECURITY_ROOT_KEYS);
  const locksBefore = [...(before.locks ?? [])].sort().join('\n');
  const locksAfter = [...(after.locks ?? [])].sort().join('\n');

  return {
    changedRoots,
    securityRootsChanged: changedRoots.filter((key) => security.has(key)),
    locksChanged: locksBefore !== locksAfter,
    secretKeysChanged: secretsPatch === null ? ['*'] : Object.keys(secretsPatch ?? {}).sort(),
  };
}

/** Whether a summary contains any change worth notifying about. */
export function hasAgentConfigChanges(summary: AgentConfigChangeSummary): boolean {
  return summary.changedRoots.length > 0 || summary.locksChanged || summary.secretKeysChanged.length > 0;
}
