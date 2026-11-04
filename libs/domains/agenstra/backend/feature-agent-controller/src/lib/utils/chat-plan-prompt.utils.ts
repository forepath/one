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

export interface ChatPlanPromptOptions {
  /** A workspace user edited the plan on the plans page after the agent drafted it. */
  editedByUser?: boolean;
}

/**
 * Note for turns after a user edit: the hidden session still holds the agent's earlier drafts, which the stored plan
 * replaced.
 */
export const CHAT_PLAN_USER_EDIT_NOTE =
  'The user edited this plan directly after it was drafted. The plan below is the authoritative version: it ' +
  'replaces every earlier draft. Do not reintroduce or act on steps, files or decisions from earlier drafts that ' +
  'are not part of it.';

export function buildRefinePrompt(
  refineMessage: string,
  currentPlanMarkdown?: string | null,
  options: ChatPlanPromptOptions = {},
): string {
  const plan = currentPlanMarkdown?.trim() ?? '';
  const editNote = plan && options.editedByUser ? `${CHAT_PLAN_USER_EDIT_NOTE}\n\n` : '';
  const planSection = plan ? `Current plan draft:\n${plan}\n\n` : '';

  return `${buildRefinePromptPreamble()}${editNote}${planSection}` + `Refine instructions:\n${refineMessage.trim()}\n`;
}

/**
 * Repair prompt used when the hidden planning turn completed but did not provide usable plan content.
 */
export function buildPlanRepairPrompt(currentPlanMarkdown?: string | null): string {
  const planSection =
    currentPlanMarkdown && currentPlanMarkdown.trim()
      ? `Current partial plan markdown, if useful:\n${currentPlanMarkdown.trim()}\n\n`
      : '';

  return (
    `Your previous planning response did not include usable structured plan content. ` +
    `Do not mutate files. Repair the response now by returning structured status (${planStatusEnumHint()}) as JSON only ` +
    `(keys: status, planMarkdown, summary). planMarkdown must be pure markdown for the user, and must not be empty. ` +
    `Use "ready" when the plan is complete enough to review and execute; otherwise use "exploring" with the best ` +
    `planMarkdown you can provide. Do not ask questions.\n\n${planSection}`
  );
}

/**
 * Leading line of {@link buildExecutePrompt}. Used to hide already-persisted execute triggers in the UI.
 */
export const CHAT_PLAN_EXECUTE_PROMPT_PREFIX =
  'Implement the following plan in the repository. Stay scoped to the plan below.';

/** Always part of the execute prompt: only the stored (latest saved) plan may be implemented. */
export const CHAT_PLAN_EXECUTE_AUTHORITATIVE_NOTE =
  'The plan below is the final version saved for execution. It supersedes every earlier draft of this plan; ' +
  'implement only what it contains.';

/**
 * Wrapper sent to the agent when the user executes a ready plan.
 * Execution runs in the plan's visible chat (normal permissions; the prompt itself is not shown as a user message).
 * Earlier drafts may be known to the agent (chat history, plan cards), so the prompt states that the stored plan is
 * the only version to implement (and calls out user edits made on the plans page explicitly).
 */
export function buildExecutePrompt(
  planMarkdown: string,
  sourcePrompt?: string | null,
  options: ChatPlanPromptOptions = {},
): string {
  const requestSection = sourcePrompt && sourcePrompt.trim() ? `Original request:\n${sourcePrompt.trim()}\n\n` : '';
  const editNote = options.editedByUser ? ` ${CHAT_PLAN_USER_EDIT_NOTE}` : '';

  return (
    `${CHAT_PLAN_EXECUTE_PROMPT_PREFIX}\n\n` +
    `${CHAT_PLAN_EXECUTE_AUTHORITATIVE_NOTE}${editNote}\n\n` +
    `${requestSection}` +
    `## Plan\n\n${planMarkdown.trim()}\n`
  );
}
