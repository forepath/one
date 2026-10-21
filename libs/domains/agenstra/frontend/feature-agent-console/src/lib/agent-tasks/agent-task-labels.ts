import type { FpcBadgeColor } from '@forepath/shared/frontend/ui-components';

/** Operator-facing label for an agent task run status (chat card + `/tasks` page). */
export function agentTaskRunStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'running':
      return $localize`:@@featureAgentTasks-runStatusRunning:Running`;
    case 'awaiting_handoff':
      return $localize`:@@featureAgentTasks-runStatusAwaitingHandoff:Waiting for handoff`;
    case 'succeeded':
      return $localize`:@@featureAgentTasks-runStatusSucceeded:Succeeded`;
    case 'failed':
      return $localize`:@@featureAgentTasks-runStatusFailed:Failed`;
    default:
      return $localize`:@@featureAgentTasks-runStatusNever:Not run yet`;
  }
}

export function agentTaskRunStatusBadgeColor(status: string | null | undefined): FpcBadgeColor {
  switch (status) {
    case 'running':
      return 'warning';
    case 'awaiting_handoff':
      return 'info';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'secondary';
  }
}

export function agentTaskRunTriggerLabel(trigger: string): string {
  return trigger === 'manual'
    ? $localize`:@@featureAgentTasks-runTriggerManual:Manual`
    : $localize`:@@featureAgentTasks-runTriggerSchedule:Scheduled`;
}

/** Common schedules offered in the task editor (free cron input stays available). */
export interface AgentTaskSchedulePreset {
  cron: string;
  label: string;
}

export function agentTaskSchedulePresets(): AgentTaskSchedulePreset[] {
  return [
    { cron: '0 * * * *', label: $localize`:@@featureAgentTasks-presetHourly:Every hour` },
    { cron: '0 9 * * *', label: $localize`:@@featureAgentTasks-presetDaily:Every day at 09:00` },
    { cron: '0 9 * * 1-5', label: $localize`:@@featureAgentTasks-presetWeekdays:Weekdays at 09:00` },
    { cron: '0 9 * * 1', label: $localize`:@@featureAgentTasks-presetWeekly:Every Monday at 09:00` },
    { cron: '0 9 1 * *', label: $localize`:@@featureAgentTasks-presetMonthly:First day of the month at 09:00` },
  ];
}

/** Minute step of step schedules (every N minutes) or evenly spaced minute lists (`0,30 * * * *`), otherwise `null`. */
function everyMinutesStep(cronExpression: string): number | null {
  const [minute, ...rest] = cronExpression.trim().split(/\s+/);

  if (rest.length !== 4 || rest.some((field) => field !== '*') || !minute) {
    return null;
  }

  const step = /^\*\/(\d{1,2})$/.exec(minute);

  if (step) {
    const value = Number(step[1]);

    return value > 0 && 60 % value === 0 ? value : null;
  }

  const minutes = minute.split(',').map(Number);

  if (minutes.length < 2 || minutes.some((value) => !Number.isInteger(value) || value < 0 || value > 59)) {
    return null;
  }

  const gap = minutes[1] - minutes[0];

  return gap > 0 && minutes.length * gap === 60 && minutes.every((value, index) => value === minutes[0] + index * gap)
    ? gap
    : null;
}

/** Human-readable schedule: preset label, "Every N minutes", otherwise the expression itself. */
export function describeAgentTaskSchedule(cronExpression: string, timezone: string): string {
  const preset = agentTaskSchedulePresets().find((entry) => entry.cron === cronExpression.trim());
  const minutes = preset ? null : everyMinutesStep(cronExpression);
  const label = preset
    ? preset.label
    : minutes !== null
      ? $localize`:@@featureAgentTasks-scheduleEveryMinutes:Every ${minutes}:minutes: minutes`
      : cronExpression;

  return `${label} (${timezone})`;
}
