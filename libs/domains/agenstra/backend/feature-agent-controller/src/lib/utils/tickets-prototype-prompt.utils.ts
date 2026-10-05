/**
 * Preamble for autonomous ticket runs: instructs structured OpenCode turn status.
 */
import { AGENSTRA_AUTOMATION_TURN_STATUS_SCHEMA } from '@forepath/agenstra/shared/util-opencode-config';

import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

export interface TicketPromptNode {
  id: string;
  title: string;
  content?: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  children: TicketPromptNode[];
}

/**
 * Builds a plain-text prompt describing the ticket tree for agent prototyping.
 */
export function buildPrototypePrompt(root: TicketPromptNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [`${indent}- [${root.id}] ${root.title} (${root.status}, ${root.priority})`];

  if (root.content?.trim()) {
    lines.push(`${indent}  Content:\n${indent}  ${root.content.trim().split('\n').join(`\n${indent}  `)}`);
  }

  for (const child of root.children) {
    lines.push(buildPrototypePrompt(child, depth + 1));
  }

  return lines.join('\n');
}

export function buildPrototypePromptPreamble(): string {
  return `You are helping implement a scoped piece of work. The prompt may include parent tickets for broader scope, then the selected ticket with every nested subtask (title, status, priority, content), then related knowledge/tickets linked via relations (related tickets include their own nested subtasks; related folders include all pages in the subtree). Use this hierarchy and related context to produce a concrete prototype or implementation plan as requested by the user.\n\n`;
}

/**
 * Appends related-context sections collected from knowledge relations.
 */
export function appendRelatedContextSections(body: string, sections: string[]): string {
  const cleaned = sections.map((section) => section.trim()).filter((section) => section.length > 0);

  if (cleaned.length === 0) {
    return body;
  }

  const labeled = cleaned.map((section, index) => `### Related context ${index + 1}\n${section}`);

  return `${body.trimEnd()}\n\nRelated context (from knowledge relations):\n${labeled.join('\n\n')}\n`;
}

/**
 * Preamble for autonomous ticket runs: implement freely; status is collected after the turn.
 */
export function buildAutonomousTicketRunPreamble(): string {
  const statusEnum = AGENSTRA_AUTOMATION_TURN_STATUS_SCHEMA.properties.status.enum.join(' | ');

  return (
    buildPrototypePromptPreamble() +
    `This is an unattended automation turn. Implement the scoped work using tools as needed. ` +
    `When finished with this turn, the platform will collect structured status (${statusEnum}). ` +
    `Aim for "complete" only when the scoped prototype is ready for verification; otherwise leave more work for a follow-up turn. ` +
    `Do not ask the user questions.\n\n`
  );
}
