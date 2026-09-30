import { BadRequestException } from '@nestjs/common';

/** Root for proxied file operations (application workspace `/app`). */
export type AgentFileManagerContext = 'app';

/**
 * Parse optional `context` query param. Omitted or empty defaults to `app`.
 * Legacy `config` is rejected (provider config file manager removed).
 */
export function parseAgentFileManagerContext(value: string | undefined): AgentFileManagerContext {
  if (value === undefined || value === null || value.trim() === '') {
    return 'app';
  }

  const v = value.trim();

  if (v === 'app') {
    return v;
  }

  throw new BadRequestException(`Invalid context: ${value}. Allowed value is "app".`);
}
