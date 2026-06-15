import { TicketPriority, TicketStatus } from '../entities/ticket.enums';

import { AGENSTRA_AUTOMATION_COMPLETE } from './automation-completion.constants';

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
  return `You are helping implement a scoped piece of work. The prompt may include parent tickets for broader scope, then the selected ticket with every nested subtask (title, status, priority, content). Use this hierarchy to produce a concrete prototype or implementation plan as requested by the user.\n\n`;
}

/**
 * Preamble for autonomous ticket runs: instructs the agent to emit the completion marker when done.
 */
export function buildAutonomousTicketRunPreamble(): string {
  return (
    buildPrototypePromptPreamble() +
    `When the scoped prototype work is complete and ready for verification, you MUST include the exact line ` +
    `${AGENSTRA_AUTOMATION_COMPLETE} in your reply (on its own line is best). ` +
    `Do not claim completion without that marker.\n\n`
  );
}
