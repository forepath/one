import type { AgentTaskRunTrigger } from '@forepath/agenstra/shared/util-opencode-config';

import type { AgentTaskEntity } from '../entities/agent-task.entity';

/**
 * Prompt of one unattended task run. Runs of a task share one hidden session, so earlier runs are in the
 * transcript; the task text is repeated on every run because the user may have changed it in between.
 */
export function buildAgentTaskRunPrompt(
  task: Pick<AgentTaskEntity, 'title' | 'prompt' | 'cronExpression' | 'timezone'>,
  trigger: AgentTaskRunTrigger,
  scheduledFor: Date,
): string {
  const when =
    trigger === 'manual'
      ? `started manually at ${scheduledFor.toISOString()}`
      : `scheduled for ${scheduledFor.toISOString()} (cron "${task.cronExpression}", ${task.timezone})`;

  return [
    `You are running your recurring task "${task.title}" unattended (${when}).`,
    'Nobody can answer questions or approve actions during this run: proceed with reasonable defaults and do not ask.',
    'Earlier runs of this task are part of this session. End with a concise summary of what you did and the results;',
    'it is posted to the main chat.',
    '',
    '## Task',
    '',
    task.prompt.trim(),
    '',
  ].join('\n');
}

/** Keep the tail of long answers (summaries come last). */
export function truncateAgentTaskOutput(text: string, maxLength: number): string {
  const trimmed = text.trim();

  return trimmed.length <= maxLength ? trimmed : `…${trimmed.slice(trimmed.length - maxLength + 1)}`;
}
