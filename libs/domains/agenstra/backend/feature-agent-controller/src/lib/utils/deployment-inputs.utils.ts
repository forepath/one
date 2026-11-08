import { DEPLOYMENT_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException } from '@nestjs/common';

/**
 * Input / variable / parameter names accepted for deployment workflows (GitHub workflow_dispatch inputs, GitLab
 * pipeline variables, Jenkins build parameters): a letter or `_` first, then letters, digits, `_`, `-`, `.`.
 */
export const DEPLOYMENT_INPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const FORBIDDEN_INPUT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Why `value` is not a valid string → string inputs map (bounded by {@link DEPLOYMENT_LIMITS}), or null. */
export function deploymentInputsError(value: unknown, field = 'inputs'): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `${field} must be an object of string values`;
  }

  const entries = Object.entries(value as Record<string, unknown>);

  if (entries.length > DEPLOYMENT_LIMITS.inputsMax) {
    return `${field} may contain at most ${DEPLOYMENT_LIMITS.inputsMax} entries`;
  }

  for (const [key, entry] of entries) {
    if (
      key.length === 0 ||
      key.length > DEPLOYMENT_LIMITS.inputKeyMaxLength ||
      !DEPLOYMENT_INPUT_KEY_PATTERN.test(key) ||
      FORBIDDEN_INPUT_KEYS.has(key)
    ) {
      return `${field} keys must match ${DEPLOYMENT_INPUT_KEY_PATTERN.source} (at most ${DEPLOYMENT_LIMITS.inputKeyMaxLength} characters)`;
    }

    if (typeof entry !== 'string') {
      return `${field}.${key} must be a string`;
    }

    if (entry.length > DEPLOYMENT_LIMITS.inputValueMaxLength) {
      return `${field}.${key} must be at most ${DEPLOYMENT_LIMITS.inputValueMaxLength} characters`;
    }
  }

  return null;
}

/** Validated copy of an inputs map (undefined / null: empty); throws {@link BadRequestException}. */
export function normalizeDeploymentInputs(value: unknown, field = 'inputs'): Record<string, string> {
  if (value === undefined || value === null) {
    return {};
  }

  const error = deploymentInputsError(value, field);

  if (error) {
    throw new BadRequestException(error);
  }

  return Object.fromEntries(Object.entries(value as Record<string, string>));
}

/** Workflow default inputs overridden by the run inputs; the merged map is bounded again. */
export function mergeDeploymentInputs(
  defaults: Record<string, string> | null | undefined,
  overrides: Record<string, string> | null | undefined,
): Record<string, string> {
  return normalizeDeploymentInputs({ ...(defaults ?? {}), ...(overrides ?? {}) });
}
