import { BadRequestException } from '@nestjs/common';

import {
  AGENT_TASK_DEFAULT_TIMEZONE,
  computeNextAgentTaskRunAt,
  isValidAgentTaskTimezone,
  parseAgentTaskSchedule,
} from './agent-task-schedule.utils';

describe('agent task schedule utils', () => {
  const fiveMinutes = 5 * 60_000;
  const now = new Date('2026-10-21T10:00:00.000Z');

  it('normalizes whitespace and defaults the time zone to UTC', () => {
    expect(parseAgentTaskSchedule('  0   9 * *  1-5 ', undefined, fiveMinutes, now)).toEqual({
      cronExpression: '0 9 * * 1-5',
      timezone: AGENT_TASK_DEFAULT_TIMEZONE,
    });
    expect(parseAgentTaskSchedule('0 9 * * *', ' Europe/Berlin ', fiveMinutes, now).timezone).toBe('Europe/Berlin');
  });

  it('requires exactly five fields', () => {
    expect(() => parseAgentTaskSchedule('*/30 * * * * *', 'UTC', fiveMinutes, now)).toThrow(BadRequestException);
    expect(() => parseAgentTaskSchedule('0 9 * *', 'UTC', fiveMinutes, now)).toThrow(BadRequestException);
  });

  it('rejects invalid expressions and unknown time zones', () => {
    expect(() => parseAgentTaskSchedule('61 9 * * *', 'UTC', fiveMinutes, now)).toThrow(BadRequestException);
    expect(() => parseAgentTaskSchedule('0 9 * * *', 'Mars/Olympus', fiveMinutes, now)).toThrow(BadRequestException);
  });

  it('enforces the minimum interval between occurrences', () => {
    expect(() => parseAgentTaskSchedule('* * * * *', 'UTC', fiveMinutes, now)).toThrow(/at least 5 minutes/);
    expect(() => parseAgentTaskSchedule('0,1 9 * * *', 'UTC', fiveMinutes, now)).toThrow(BadRequestException);
    expect(parseAgentTaskSchedule('*/5 * * * *', 'UTC', fiveMinutes, now).cronExpression).toBe('*/5 * * * *');
  });

  it('computes the next occurrence in the task time zone', () => {
    // 09:00 Europe/Berlin is 07:00 UTC in October (CEST).
    expect(computeNextAgentTaskRunAt('0 9 * * *', 'Europe/Berlin', now).toISOString()).toBe('2026-10-22T07:00:00.000Z');
    expect(computeNextAgentTaskRunAt('30 10 * * *', 'UTC', now).toISOString()).toBe('2026-10-21T10:30:00.000Z');
  });

  it('validates IANA time zones', () => {
    expect(isValidAgentTaskTimezone('America/New_York')).toBe(true);
    expect(isValidAgentTaskTimezone('Not/AZone')).toBe(false);
  });
});
