import {
  AGENT_HANDOFF_CHAT_SESSION_KIND,
  isAgentTaskResumeSessionSuffix,
} from '@forepath/agenstra/shared/util-opencode-config';

/**
 * User-visible chat session kinds stored in `agent_chat_sessions`.
 * Hidden session suffixes (prompt enhance, ticket body, automation, plan) are not persisted as rows.
 * `handoff` chats are regular chats opened by the controller for a task handed over by another agent.
 */
export const AGENT_CHAT_SESSION_KINDS = ['primary', 'user', AGENT_HANDOFF_CHAT_SESSION_KIND] as const;

export type AgentChatSessionKind = (typeof AGENT_CHAT_SESSION_KINDS)[number];

/** Kinds that can be created through the chat sessions API (the primary chat is implicit). */
export const CREATABLE_AGENT_CHAT_SESSION_KINDS = ['user', AGENT_HANDOFF_CHAT_SESSION_KIND] as const;

export type CreatableAgentChatSessionKind = (typeof CREATABLE_AGENT_CHAT_SESSION_KINDS)[number];

/** Empty suffix is the primary OpenCode chat session. */
export const PRIMARY_CHAT_RESUME_SESSION_SUFFIX = '';

/** Prefix for user-created chat session suffixes (`-chat-{uuid}`). */
export const USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX = '-chat-';

/**
 * Hidden read-only session in which an agent describes itself when a peer requests its missing handoff profile
 * (explore tools only, like plan sessions, but with the default agent and plain answers).
 */
export const HANDOFF_PROFILE_RESUME_SESSION_SUFFIX = '-handoff-profile';

/** Prefix for chat plan-mode hidden OpenCode sessions (`-plan-{planId}`). */
export const CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX = '-plan-';

/**
 * Reserved resumeSessionSuffix values used by background/hidden flows.
 * These must never collide with user-visible chat session suffixes.
 * Dynamic `-plan-{uuid}` and `-task-{uuid}` suffixes are also reserved via {@link isChatPlanResumeSessionSuffix}
 * and `isAgentTaskResumeSessionSuffix`.
 */
export const RESERVED_CHAT_RESUME_SESSION_SUFFIXES = [
  '-prompt-enhance',
  '-ticket-body',
  '-ticket-auto-pre',
  '-ticket-auto-loop',
  '-ticket-auto-commit-msg',
  HANDOFF_PROFILE_RESUME_SESSION_SUFFIX,
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

  if (isChatPlanResumeSessionSuffix(suffix) || isAgentTaskResumeSessionSuffix(suffix)) {
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

/**
 * Unattended hidden sessions (ticket automation, recurring agent task runs): nobody can answer prompts, so they
 * run with the platform automation agent, auto-reply permissions and require the controller trust marker.
 */
export function isUnattendedAutomationResumeSessionSuffix(suffix: string | undefined): boolean {
  return isTicketAutomationResumeSessionSuffix(suffix) || isAgentTaskResumeSessionSuffix(suffix);
}

/**
 * Read-only hidden sessions (plan explore / refine, handoff profile generation): session ruleset with explore tools
 * only; residual permission asks are answered automatically (explore allowed, everything else rejected).
 */
export function isReadOnlyExploreResumeSessionSuffix(suffix: string | undefined): boolean {
  return isChatPlanResumeSessionSuffix(suffix) || suffix === HANDOFF_PROFILE_RESUME_SESSION_SUFFIX;
}

/** Implementation-loop sessions request structured continue/complete turn status. */
export function isTicketAutomationLoopResumeSessionSuffix(suffix: string | undefined): boolean {
  return suffix === '-ticket-auto-loop';
}

export function buildUserChatResumeSessionSuffix(chatId: string): string {
  return `${USER_CHAT_RESUME_SESSION_SUFFIX_PREFIX}${chatId}`;
}
