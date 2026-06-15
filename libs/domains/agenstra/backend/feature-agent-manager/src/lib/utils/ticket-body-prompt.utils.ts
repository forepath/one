/**
 * Isolated agent session suffix for ticket body generation (title → description).
 */
export const PROMPT_TICKET_BODY_RESUME_SESSION_SUFFIX = '-ticket-body';

/**
 * Wraps the ticket title so the model returns only ticket description/body text.
 * Optional `hierarchyContext` adds parent tickets and/or subtasks (same shape as prototype prompts).
 */
export function buildTicketBodyFromTitleMessage(title: string, hierarchyContext?: string | null): string {
  const trimmedTitle = title.trim();
  const ctx = hierarchyContext?.trim();
  let message = `You are a product/spec assistant. The ticket title is between <<<TITLE>>> and <<<END_TITLE>>>.
Write clear ticket body content: acceptance criteria, technical notes, and context. Use markdown where helpful.
When <<<TICKET_TREE>>> is present, use it as supporting context (parent goals and subtask breakdown); synthesize a cohesive body for the titled ticket, not a duplicate list.
Output ONLY the body text for the ticket. No preamble, no "Here is", no code fences wrapping the entire answer.

<<<TITLE>>>
${trimmedTitle}
<<<END_TITLE>>>`;

  if (ctx) {
    message += `

<<<TICKET_TREE>>>
${ctx}
<<<END_TICKET_TREE>>>`;
  }

  return message;
}
