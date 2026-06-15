import { BadRequestException } from '@nestjs/common';

import type { TicketVerifierProfileJson } from '../entities/ticket-automation.entity';

const MAX_CMD_LENGTH = 2048;
const MAX_COMMANDS = 32;
const ALLOWED_PREFIXES = (): string[] => {
  const raw = process.env.AUTOMATION_VERIFY_CMD_PREFIX_ALLOWLIST;

  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

function assertNoShellInjection(cmd: string): void {
  if (cmd.includes('\n') || cmd.includes('\r')) {
    throw new BadRequestException('Verifier command must not contain newlines');
  }

  if (cmd.length > MAX_CMD_LENGTH) {
    throw new BadRequestException(`Verifier command exceeds maximum length (${MAX_CMD_LENGTH})`);
  }
}

/**
 * Allowlist verifier commands: length bounds, no newlines, optional comma-separated prefix allowlist via env.
 */
export function parseAndValidateVerifierProfile(raw: unknown): TicketVerifierProfileJson {
  if (raw === null || raw === undefined) {
    return { commands: [] };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('verifierProfile must be an object');
  }

  const obj = raw as { commands?: unknown };

  if (!Array.isArray(obj.commands)) {
    throw new BadRequestException('verifierProfile.commands must be an array');
  }

  if (obj.commands.length > MAX_COMMANDS) {
    throw new BadRequestException(`verifierProfile.commands must have at most ${MAX_COMMANDS} entries`);
  }

  const prefixes = ALLOWED_PREFIXES();
  const commands: Array<{ cmd: string; cwd?: string }> = [];

  for (const entry of obj.commands) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new BadRequestException('Each verifier command must be an object');
    }

    const e = entry as { cmd?: unknown; cwd?: unknown };

    if (typeof e.cmd !== 'string' || !e.cmd.trim()) {
      throw new BadRequestException('Each verifier command must include a non-empty cmd string');
    }

    const cmd = e.cmd.trim();

    assertNoShellInjection(cmd);

    if (prefixes.length > 0 && !prefixes.some((p) => cmd.startsWith(p))) {
      throw new BadRequestException('Verifier command does not match configured prefix allowlist');
    }

    let cwd: string | undefined;

    if (e.cwd !== undefined) {
      if (typeof e.cwd !== 'string') {
        throw new BadRequestException('verifier cwd must be a string when provided');
      }

      cwd = e.cwd.trim();
      assertNoShellInjection(cwd);
    }

    commands.push(cwd ? { cmd, cwd } : { cmd });
  }

  return { commands };
}
