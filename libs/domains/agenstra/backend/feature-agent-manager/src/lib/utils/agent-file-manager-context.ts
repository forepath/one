import { BadRequestException } from '@nestjs/common';

/** Root for proxied file operations: application workspace vs provider agent config directory. */
export type AgentFileManagerContext = 'app' | 'config';

/**
 * Parse optional `context` query param. Omitted or empty defaults to `app` for backward compatibility.
 */
export function parseAgentFileManagerContext(value: string | undefined): AgentFileManagerContext {
  if (value === undefined || value === null || value.trim() === '') {
    return 'app';
  }

  const v = value.trim();

  if (v === 'app' || v === 'config') {
    return v;
  }

  throw new BadRequestException(`Invalid context: ${value}. Allowed values are "app" and "config".`);
}
