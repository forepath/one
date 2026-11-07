import type { InitiativeUnknownEntity } from '../entities/initiative-unknown.entity';
import type { InitiativeWorkItemEntity } from '../entities/initiative-work-item.entity';
import type { InitiativeEntity } from '../entities/initiative.entity';

/** Ticket title of a transferred work item (`[E1.S2] Title`). */
export function initiativeTicketTitle(item: Pick<InitiativeWorkItemEntity, 'key' | 'title'>): string {
  return `[${item.key}] ${item.title}`.slice(0, 500);
}

/**
 * Ticket body of a transferred work item: requirements, checks and the refs agents use to read the planning context
 * (`initiative:<sha>`) through the context MCP. Regenerated when an accepted proposal changes a story that has not
 * started.
 */
export function buildInitiativeTicketBody(
  initiative: Pick<InitiativeEntity, 'title' | 'longSha' | 'iteration'>,
  item: InitiativeWorkItemEntity,
  context: { epic?: InitiativeWorkItemEntity | null; after: string[]; unknowns: InitiativeUnknownEntity[] },
): string {
  const lines: string[] = [];
  const section = (title: string, body: string | undefined | null) => {
    if (body?.trim()) {
      lines.push(`## ${title}`, '', body.trim(), '');
    }
  };

  lines.push(
    `> ${item.kind === 'epic' ? 'Epic' : item.kind === 'spike' ? 'Spike' : item.kind === 'bug' ? 'Bug' : 'Story'} ` +
      `**${item.key}** of initiative "${initiative.title}" (initiative:${initiative.longSha ?? ''}, iteration ` +
      `${initiative.iteration}). Planning documents and decisions: read the initiative with agenstra_context_get.`,
    '',
  );

  if (context.epic) {
    lines.push(`Epic: **${context.epic.key}** ${context.epic.title}`, '');
  }

  if (context.after.length > 0) {
    lines.push(`Builds after: ${context.after.join(', ')}`, '');
  }

  section(item.kind === 'epic' ? 'Outcome and requirements' : 'Requirements', item.requirements);
  section('Verify', item.verify);
  section('Done when', item.doneWhen);

  const open = context.unknowns.filter((unknown) => !unknown.resolvedAt);
  const resolved = context.unknowns.filter((unknown) => !!unknown.resolvedAt);

  if (open.length > 0) {
    lines.push('## Open questions', '', ...open.map((unknown) => `- ${unknown.question} (${unknown.resolution})`), '');
  }

  if (resolved.length > 0) {
    lines.push(
      '## Settled questions',
      '',
      ...resolved.map((unknown) => `- ${unknown.question}: ${unknown.answer ?? ''}`.trim()),
      '',
    );
  }

  return lines.join('\n').trim();
}
