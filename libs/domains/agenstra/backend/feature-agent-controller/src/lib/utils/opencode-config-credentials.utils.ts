import {
  assertNoCredentialKeysInConfig as assertNoCredentialKeysInConfigShared,
  OpencodeConfigValidationError,
  type JsonObject,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException } from '@nestjs/common';

/**
 * Rejects credential-like keys in non-secret OpenCode config so they must use the encrypted secrets map.
 */
export function assertNoCredentialKeysInConfig(config: Record<string, unknown> | null | undefined): void {
  try {
    assertNoCredentialKeysInConfigShared(config as JsonObject | null | undefined);
  } catch (error) {
    if (error instanceof OpencodeConfigValidationError) {
      throw new BadRequestException(error.message);
    }

    throw error;
  }
}
