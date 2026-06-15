import type { TicketEntity } from '../entities/ticket.entity';

/**
 * Prompt for a one-line Conventional Commits subject via the same remote `chat` sync path as other
 * autonomous ticket background turns (ephemeral session, isolated resume suffix).
 */
export function buildAutonomousCommitMessagePrompt(
  ticket: Pick<TicketEntity, 'id' | 'title'>,
  branchName: string,
): string {
  const title = (ticket.title ?? '').replace(/\s+/g, ' ').trim();

  return [
    'You help write git commit messages.',
    'Reply with exactly ONE line only: a Conventional Commits subject (format: type(scope): description, or type: description).',
    'Types: feat, fix, chore, docs, style, refactor, test, or perf. Use scope "automation" when unsure.',
    'Max 120 characters. No quotes, markdown, code fences, or explanation.',
    '',
    `Ticket ID: ${ticket.id}`,
    `Ticket title: ${title}`,
    `Branch: ${branchName || '(unknown)'}`,
    '',
    'Summarize the implemented work in that single subject line.',
  ].join('\n');
}

/** Loose Conventional Commits subject check (type, optional scope, colon, non-empty description). */
export function isPlausibleConventionalSubject(s: string): boolean {
  return /^(feat|fix|chore|docs|style|refactor|test|perf|build|ci)(\([^)]*\))?!?:\s+.+$/i.test(s.trim());
}

/**
 * Takes raw model output; returns a single-line subject or null if unusable.
 */
export function sanitizeConventionalCommitSubject(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const first = lines[0] ?? '';
  const s = first.replace(/^[`"'“”]+|[`"'“”]+$/g, '').trim();

  if (s.startsWith('```')) {
    return null;
  }

  if (s.length < 5 || s.length > 200) {
    return null;
  }

  if (!isPlausibleConventionalSubject(s)) {
    return null;
  }

  return s;
}

export function buildFallbackAutonomousCommitMessage(ticket: Pick<TicketEntity, 'title'>): string {
  const t = (ticket.title ?? '').replace(/\s+/g, ' ').trim();
  const truncated = t.length > 100 ? `${t.slice(0, 97)}...` : t;

  return `feat(automation): ${truncated || 'prototype run'}`;
}
