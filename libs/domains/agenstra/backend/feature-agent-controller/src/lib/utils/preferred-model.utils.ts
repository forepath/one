import { BadRequestException } from '@nestjs/common';

/** Max length stored for preferred OpenCode `provider/model` strings. */
export const PREFERRED_MODEL_MAX_LENGTH = 256;

/**
 * OpenCode model option: `providerID/modelID` (slash required).
 * Allows common provider/model id characters used by the catalog.
 */
export const PREFERRED_MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9._+/-]{0,127}$/;

export function normalizePreferredModel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}

export function assertValidPreferredModel(value: string | null | undefined): string | null {
  const normalized = normalizePreferredModel(value);

  if (normalized === null) {
    return null;
  }

  if (normalized.length > PREFERRED_MODEL_MAX_LENGTH || !PREFERRED_MODEL_PATTERN.test(normalized)) {
    throw new BadRequestException('Invalid preferred model; expected provider/model');
  }

  return normalized;
}
