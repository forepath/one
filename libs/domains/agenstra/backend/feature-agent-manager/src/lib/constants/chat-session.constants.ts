/**
 * User-visible chat session kinds stored in `agent_chat_sessions`.
 * Hidden ACP suffixes (prompt enhance, ticket body, automation, plan) are not persisted as rows.
 */
export const AGENT_CHAT_SESSION_KINDS = ['primary', 'user'] as const;

export type AgentChatSessionKind = (typeof AGENT_CHAT_SESSION_KINDS)[number];

/** Empty suffix is the primary ACP chat session. */
export const PRIMARY_CHAT_RESUME_SESSION_SUFFIX = '';

/** Prefix for user-created chat ACP suffixes (`-chat-{uuid}`). */
export const USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX = '-chat-';

/** Prefix for chat plan-mode hidden OpenCode sessions (`-plan-{planId}`). */
export const CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX = '-plan-';

/**
 * Reserved ACP resumeSessionSuffix values used by background/hidden flows.
 * These must never collide with user-visible chat session suffixes.
 * Dynamic `-plan-{uuid}` suffixes are also reserved via {@link isChatPlanResumeSessionSuffix}.
 */
export const RESERVED_CHAT_RESUME_SESSION_SUFFIXES = [
  '-prompt-enhance',
  '-ticket-body',
  '-ticket-auto-pre',
  '-ticket-auto-loop',
  '-ticket-auto-commit-msg',
] as const;

/** Reserved suffixes used by autonomous ticket-run OpenCode sessions. */
export const TICKET_AUTOMATION_RESUME_SESSION_SUFFIXES = [
  '-ticket-auto-pre',
  '-ticket-auto-loop',
  '-ticket-auto-commit-msg',
] as const;

export function isChatPlanResumeSessionSuffix(suffix: string | undefined): boolean {
  if (suffix === undefined || suffix === PRIMARY_CHAT_RESUME_SESSION_SUFFIX) {
    return false;
  }

  return (
    suffix.startsWith(CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX) &&
    suffix.length > CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX.length
  );
}

export function buildChatPlanResumeSessionSuffix(planId: string): string {
  return `${CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX}${planId}`;
}

export function isReservedChatResumeSessionSuffix(suffix: string | undefined): boolean {
  if (suffix === undefined || suffix === PRIMARY_CHAT_RESUME_SESSION_SUFFIX) {
    return false;
  }

  if (isChatPlanResumeSessionSuffix(suffix)) {
    return true;
  }

  return (RESERVED_CHAT_RESUME_SESSION_SUFFIXES as readonly string[]).includes(suffix);
}

/** True for ticket automation hidden sessions (unattended permission / structured turn status). */
export function isTicketAutomationResumeSessionSuffix(suffix: string | undefined): boolean {
  if (suffix === undefined || suffix === PRIMARY_CHAT_RESUME_SESSION_SUFFIX) {
    return false;
  }

  return (TICKET_AUTOMATION_RESUME_SESSION_SUFFIXES as readonly string[]).includes(suffix);
}

/** Implementation-loop sessions request structured continue/complete turn status. */
export function isTicketAutomationLoopResumeSessionSuffix(suffix: string | undefined): boolean {
  return suffix === '-ticket-auto-loop';
}

export function buildUserChatResumeSessionSuffix(chatId: string): string {
  return `${USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX}${chatId}`;
}
