import { AGENSTRA_PLAN_TURN_STATUS_SCHEMA } from '@forepath/agenstra/shared/util-opencode-config';

/** Prefix for chat plan-mode hidden OpenCode sessions (`-plan-{planId}`). */
export const CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX = '-plan-';

export function buildChatPlanResumeSessionSuffix(planId: string): string {
  return `${CHAT_PLAN_RESUME_SESSION_SUFFIX_PREFIX}${planId}`;
}

function planStatusEnumHint(): string {
  return AGENSTRA_PLAN_TURN_STATUS_SCHEMA.properties.status.enum.join(' | ');
}

/**
 * Preamble for the first explore turn on a hidden `-plan-{id}` session.
 */
export function buildExplorePromptPreamble(): string {
  return (
    `You are running an explore-only planning session. Do not create, edit, patch, or delete files. ` +
    `Do not run shell commands that mutate the workspace. Use read, glob, grep, and similar explore tools only. ` +
    `Investigate thoroughly, then produce a comprehensive implementation plan. ` +
    `When finished with this turn, report structured status (${planStatusEnumHint()}) as JSON only ` +
    `(keys: status, planMarkdown, summary). planMarkdown must be pure markdown for the user — ` +
    `no preamble, no status/planMarkdown labels inside it. ` +
    `Use "ready" only when planMarkdown is complete enough for the user to review and execute; otherwise "exploring". ` +
    `Do not ask the user questions.\n\n`
  );
}

export function buildExplorePrompt(sourcePrompt: string): string {
  return `${buildExplorePromptPreamble()}User request:\n${sourcePrompt.trim()}\n`;
}

/**
 * Preamble for a refine turn continuing the same `-plan-{id}` session.
 */
export function buildRefinePromptPreamble(): string {
  return (
    `Continue the explore-only planning session. Do not mutate files. ` +
    `Incorporate the user's refine instructions into the plan. ` +
    `When finished with this turn, report structured status (${planStatusEnumHint()}) as JSON only ` +
    `(keys: status, planMarkdown, summary). planMarkdown must be pure markdown for the user. ` +
    `Do not ask the user questions.\n\n`
  );
}

export function buildRefinePrompt(refineMessage: string, currentPlanMarkdown?: string | null): string {
  const planSection =
    currentPlanMarkdown && currentPlanMarkdown.trim() ? `Current plan draft:\n${currentPlanMarkdown.trim()}\n\n` : '';

  return `${buildRefinePromptPreamble()}${planSection}` + `Refine instructions:\n${refineMessage.trim()}\n`;
}

/**
 * Leading line of {@link buildExecutePrompt}. Used to hide already-persisted execute triggers in the UI.
 */
export const CHAT_PLAN_EXECUTE_PROMPT_PREFIX =
  'Implement the following plan in the repository. Stay scoped to the plan below.';

/**
 * Wrapper sent to the agent when the user executes a ready plan.
 * The user bubble is suppressed (`suppressUserMessage`); only agent replies appear in chat.
 */
export function buildExecutePrompt(planMarkdown: string, sourcePrompt?: string | null): string {
  const requestSection = sourcePrompt && sourcePrompt.trim() ? `Original request:\n${sourcePrompt.trim()}\n\n` : '';

  return `${CHAT_PLAN_EXECUTE_PROMPT_PREFIX}\n\n` + `${requestSection}` + `## Plan\n\n${planMarkdown.trim()}\n`;
}
