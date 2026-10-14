import { assertValidEgressConfig, resolveEffectiveEgressPolicy, type EffectiveEgressPolicy } from './egress-policy';
import {
  assertValidMessageFilters,
  resolveEffectiveMessageFilters,
  type EffectiveMessageFilterRule,
} from './message-filters';
import {
  EGRESS_CONFIG_ROOT,
  MESSAGE_FILTERS_CONFIG_ROOT,
  isPlainPolicyObject,
  type PlatformPolicyLayerInput,
} from './platform-policy';
import type { JsonObject } from './types';

/** Effective platform security policy for one agent (shipped with every config sync). */
export interface EffectivePlatformSecurityPolicy {
  egress: EffectiveEgressPolicy;
  messageFilters: EffectiveMessageFilterRule[];
}

/**
 * Validate platform security roots of one layer overlay (`egress`, `message_filters`).
 * @throws OpencodeConfigValidationError
 */
export function assertValidPlatformSecurityConfig(
  overlay: JsonObject | Record<string, unknown> | null | undefined,
): void {
  if (!isPlainPolicyObject(overlay)) {
    return;
  }

  assertValidEgressConfig(overlay[EGRESS_CONFIG_ROOT]);
  assertValidMessageFilters(overlay[MESSAGE_FILTERS_CONFIG_ROOT]);
}

/**
 * Resolve the effective platform security policy from composed layer overlays.
 * Pass every available layer (global, workspace, environment); order does not matter.
 */
export function resolvePlatformSecurityPolicy(
  layers: readonly PlatformPolicyLayerInput[],
): EffectivePlatformSecurityPolicy {
  return {
    egress: resolveEffectiveEgressPolicy(layers),
    messageFilters: resolveEffectiveMessageFilters(layers),
  };
}

/** Stable JSON serialization used for revision hashing (key order independent). */
export function stablePlatformPolicyJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }

    if (isPlainPolicyObject(input)) {
      const out: Record<string, unknown> = {};

      for (const key of Object.keys(input).sort()) {
        out[key] = normalize(input[key]);
      }

      return out;
    }

    return input;
  };

  return JSON.stringify(normalize(value));
}
