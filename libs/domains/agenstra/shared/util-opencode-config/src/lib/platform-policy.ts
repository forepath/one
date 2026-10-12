import { OpencodeConfigValidationError, type JsonObject } from './types';

/**
 * Platform-owned security policy roots stored in the layered agent configuration.
 * They are never sent to the OpenCode worker (stripped from the wire) — the agent manager
 * enforces them (egress guard sidecar, chat message filters).
 */
export const EGRESS_CONFIG_ROOT = 'egress';
export const MESSAGE_FILTERS_CONFIG_ROOT = 'message_filters';

/** Layer that contributed an effective policy entry (highest precedence first: global → workspace → environment). */
export type PlatformPolicyLayer = 'global' | 'workspace' | 'environment';

export const PLATFORM_POLICY_LAYERS: readonly PlatformPolicyLayer[] = ['global', 'workspace', 'environment'];

export interface PlatformPolicyLayerInput {
  source: PlatformPolicyLayer;
  overlay?: JsonObject | Record<string, unknown> | null;
}

export function isPlainPolicyObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function policyValidationError(message: string): OpencodeConfigValidationError {
  return new OpencodeConfigValidationError(message);
}

/**
 * Order layers by precedence (global first). Unknown / duplicate sources keep input order.
 */
export function orderPolicyLayersHighToLow(layers: readonly PlatformPolicyLayerInput[]): PlatformPolicyLayerInput[] {
  return [...layers].sort(
    (left, right) => PLATFORM_POLICY_LAYERS.indexOf(left.source) - PLATFORM_POLICY_LAYERS.indexOf(right.source),
  );
}
