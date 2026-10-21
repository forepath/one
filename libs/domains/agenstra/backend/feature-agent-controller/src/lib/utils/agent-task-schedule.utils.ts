import { BadRequestException } from '@nestjs/common';
import { parseExpression } from 'cron-parser';

export const AGENT_TASK_DEFAULT_TIMEZONE = 'UTC';

/** Consecutive occurrences sampled when enforcing the minimum interval (catches `0,1 9 * * *`-style bursts). */
const INTERVAL_SAMPLE_SIZE = 20;

export function isValidAgentTaskTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });

    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a five-field cron expression (no seconds) in an IANA time zone and return the normalized pair.
 * Occurrences closer than `minIntervalMs` are rejected so a task (or an agent) cannot hammer the workspace.
 */
export function parseAgentTaskSchedule(
  cronExpression: string,
  timezone: string | undefined,
  minIntervalMs: number,
  now: Date = new Date(),
): { cronExpression: string; timezone: string } {
  const expression = cronExpression.trim().replace(/\s+/g, ' ');
  const tz = timezone?.trim() || AGENT_TASK_DEFAULT_TIMEZONE;

  if (expression.split(' ').length !== 5) {
    throw new BadRequestException('cronExpression must have five fields: minute hour day-of-month month day-of-week');
  }

  if (!isValidAgentTaskTimezone(tz)) {
    throw new BadRequestException(`Unknown time zone '${tz}' (expected an IANA name such as Europe/Berlin)`);
  }

  let occurrences: Date[];

  try {
    const interval = parseExpression(expression, { currentDate: now, tz });

    occurrences = Array.from({ length: INTERVAL_SAMPLE_SIZE }, () => interval.next().toDate());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new BadRequestException(`Invalid cronExpression: ${message}`);
  }

  for (let i = 1; i < occurrences.length; i++) {
    if (occurrences[i].getTime() - occurrences[i - 1].getTime() < minIntervalMs) {
      throw new BadRequestException(
        `Runs must be at least ${Math.round(minIntervalMs / 60_000)} minutes apart (cronExpression '${expression}')`,
      );
    }
  }

  return { cronExpression: expression, timezone: tz };
}

/** Next occurrence strictly after `after` (schedule must have been validated by {@link parseAgentTaskSchedule}). */
export function computeNextAgentTaskRunAt(cronExpression: string, timezone: string, after: Date): Date {
  return parseExpression(cronExpression, { currentDate: after, tz: timezone }).next().toDate();
}
