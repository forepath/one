/**
 * Central copy for prompt-enhancement requests to the agent.
 * Keeps instructions versionable in one place.
 */
export const PROMPT_ENHANCEMENT_RESUME_SESSION_SUFFIX = '-prompt-enhance';

/**
 * Wraps the user draft with instructions so the model returns only improved prompt text.
 */
export function buildPromptEnhancementMessage(userDraft: string): string {
  return `You are a prompt-improvement assistant. The user draft is between <<<DRAFT>>> and <<<END_DRAFT>>>.
Rewrite it as a single improved user prompt: clearer, more specific, and actionable. Preserve the user's intent and domain.
Output ONLY the improved prompt text. No preamble, no explanation, no markdown code fences wrapping the entire answer.
If the draft is already optimal, return it unchanged.

<<<DRAFT>>>
${userDraft}
<<<END_DRAFT>>>`;
}
