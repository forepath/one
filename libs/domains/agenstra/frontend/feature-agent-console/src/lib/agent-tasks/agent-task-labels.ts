import type { AgentTaskResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import type { FpcBadgeColor, FpcTableState } from '@forepath/shared/frontend/ui-components';

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

/** State cell of a task run (runs table): readable status + tone + icon. */
export function agentTaskRunState(status: string | null | undefined): FpcTableState {
  const label = agentTaskRunStatusLabel(status);

  switch (status) {
    case 'running':
      return { label, tone: 'primary', icon: 'arrow-repeat' };
    case 'awaiting_handoff':
      return { label, tone: 'info', icon: 'arrow-left-right' };
    case 'succeeded':
      return { label, tone: 'success', icon: 'check-circle-fill' };
    case 'failed':
      return { label, tone: 'danger', icon: 'x-circle-fill' };
    default:
      return { label, tone: 'neutral', icon: 'dash-circle' };
  }
}

/** State cell of a task (tasks table): awaiting approval, paused, otherwise the last run's status. */
export function agentTaskState(
  task: Pick<AgentTaskResponseDto, 'approvalStatus' | 'enabled' | 'lastRunStatus'>,
): FpcTableState {
  if (task.approvalStatus === 'pending') {
    return {
      label: $localize`:@@featureAgentTasks-pendingApproval:Awaiting approval`,
      tone: 'warning',
      icon: 'hourglass-split',
    };
  }

  if (!task.enabled) {
    return { label: $localize`:@@featureAgentTasks-paused:Paused`, tone: 'neutral', icon: 'pause-circle', severity: 5 };
  }

  return agentTaskRunState(task.lastRunStatus);
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

function cronNumber(field: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) {
    return null;
  }

  const value = Number(field);

  return value >= min && value <= max ? value : null;
}

function currentLocale(): string {
  return (globalThis as { $localize?: { locale?: string } }).$localize?.locale || 'en-US';
}

/**
 * Fixed-time schedules beyond the presets (D7, AG-13: chat cards showed `3 3 1 1 * (Europe/Berlin)`): hourly at a
 * minute, daily / weekly / monthly / yearly at a time; `null` for anything else (ranges, lists, steps).
 */
function describeFixedTimeSchedule(cronExpression: string): string | null {
  const fields = cronExpression.trim().split(/\s+/);

  if (fields.length !== 5) {
    return null;
  }

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  const minute = cronNumber(minuteField, 0, 59);

  if (minute === null) {
    return null;
  }

  if (hourField === '*' && dayField === '*' && monthField === '*' && weekdayField === '*') {
    const at = String(minute).padStart(2, '0');

    return $localize`:@@featureAgentTasks-scheduleHourlyAt:Every hour at :${at}:minute:`;
  }

  const hour = cronNumber(hourField, 0, 23);

  if (hour === null) {
    return null;
  }

  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const locale = currentLocale();

  if (dayField === '*' && monthField === '*') {
    if (weekdayField === '*') {
      return $localize`:@@featureAgentTasks-scheduleDailyAt:Every day at ${time}:time:`;
    }

    const weekday = cronNumber(weekdayField, 0, 7);

    if (weekday === null) {
      return null;
    }

    // 2024-01-07 is a Sunday (cron 0 and 7).
    const day = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, 7 + (weekday % 7))),
    );

    return $localize`:@@featureAgentTasks-scheduleWeeklyAt:Every ${day}:weekday: at ${time}:time:`;
  }

  const dayOfMonth = cronNumber(dayField, 1, 31);

  if (dayOfMonth === null || weekdayField !== '*') {
    return null;
  }

  if (monthField === '*') {
    return $localize`:@@featureAgentTasks-scheduleMonthlyAt:Monthly on day ${dayOfMonth}:day: at ${time}:time:`;
  }

  const month = cronNumber(monthField, 1, 12);

  if (month === null) {
    return null;
  }

  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, month - 1, dayOfMonth)),
  );

  return $localize`:@@featureAgentTasks-scheduleYearlyAt:Every year on ${date}:date: at ${time}:time:`;
}

/**
 * Human-readable schedule: preset label, "Every N minutes", fixed times (daily / weekly / monthly / yearly),
 * otherwise the expression itself. Show the raw expression in a tooltip only.
 */
export function describeAgentTaskSchedule(cronExpression: string, timezone: string): string {
  const preset = agentTaskSchedulePresets().find((entry) => entry.cron === cronExpression.trim());
  const minutes = preset ? null : everyMinutesStep(cronExpression);
  const label = preset
    ? preset.label
    : minutes !== null
      ? $localize`:@@featureAgentTasks-scheduleEveryMinutes:Every ${minutes}:minutes: minutes`
      : (describeFixedTimeSchedule(cronExpression) ?? cronExpression);

  return `${label} (${timezone})`;
}
