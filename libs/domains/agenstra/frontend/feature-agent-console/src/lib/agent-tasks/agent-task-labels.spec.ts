import {
  agentTaskRunState,
  agentTaskRunStatusBadgeColor,
  agentTaskRunStatusLabel,
  agentTaskRunTriggerLabel,
  agentTaskSchedulePresets,
  agentTaskState,
  describeAgentTaskSchedule,
} from './agent-task-labels';

describe('agent task labels', () => {
  it('labels run states including tasks that never ran', () => {
    expect(agentTaskRunStatusLabel('running')).toBe('Running');
    expect(agentTaskRunStatusLabel('awaiting_handoff')).toBe('Waiting for handoff');
    expect(agentTaskRunStatusLabel('succeeded')).toBe('Succeeded');
    expect(agentTaskRunStatusLabel('failed')).toBe('Failed');
    expect(agentTaskRunStatusLabel(null)).toBe('Not run yet');
  });

  it('maps run states to badge colors', () => {
    expect(agentTaskRunStatusBadgeColor('succeeded')).toBe('success');
    expect(agentTaskRunStatusBadgeColor('failed')).toBe('danger');
    expect(agentTaskRunStatusBadgeColor('running')).toBe('warning');
    expect(agentTaskRunStatusBadgeColor('awaiting_handoff')).toBe('info');
    expect(agentTaskRunStatusBadgeColor(undefined)).toBe('secondary');
  });

  it('labels triggers', () => {
    expect(agentTaskRunTriggerLabel('manual')).toBe('Manual');
    expect(agentTaskRunTriggerLabel('schedule')).toBe('Scheduled');
  });

  it('describes schedules with preset labels when possible', () => {
    expect(describeAgentTaskSchedule('0 9 * * 1-5', 'Europe/Berlin')).toBe('Weekdays at 09:00 (Europe/Berlin)');
    expect(describeAgentTaskSchedule('15 3 * * 1-3', 'UTC')).toBe('15 3 * * 1-3 (UTC)');
  });

  it('describes fixed-time schedules beyond the presets instead of showing the cron', () => {
    expect(describeAgentTaskSchedule('15 3 * * 2', 'UTC')).toBe('Every Tuesday at 03:15 (UTC)');
    expect(describeAgentTaskSchedule('0 0 * * 0', 'UTC')).toBe('Every Sunday at 00:00 (UTC)');
    expect(describeAgentTaskSchedule('0 0 * * 7', 'UTC')).toBe('Every Sunday at 00:00 (UTC)');
    expect(describeAgentTaskSchedule('30 18 * * *', 'UTC')).toBe('Every day at 18:30 (UTC)');
    expect(describeAgentTaskSchedule('5 * * * *', 'UTC')).toBe('Every hour at :05 (UTC)');
    expect(describeAgentTaskSchedule('3 3 15 * *', 'Europe/Berlin')).toBe('Monthly on day 15 at 03:03 (Europe/Berlin)');
    expect(describeAgentTaskSchedule('3 3 1 1 *', 'Europe/Berlin')).toBe(
      'Every year on Jan 1 at 03:03 (Europe/Berlin)',
    );
    expect(describeAgentTaskSchedule('3 3 1 1 1', 'UTC')).toBe('3 3 1 1 1 (UTC)');
    expect(describeAgentTaskSchedule('0 25 * * *', 'UTC')).toBe('0 25 * * * (UTC)');
  });

  it('describes evenly spaced minute schedules', () => {
    expect(describeAgentTaskSchedule('0,30 * * * *', 'UTC')).toBe('Every 30 minutes (UTC)');
    expect(describeAgentTaskSchedule('*/15 * * * *', 'UTC')).toBe('Every 15 minutes (UTC)');
    expect(describeAgentTaskSchedule('5,35 * * * *', 'UTC')).toBe('Every 30 minutes (UTC)');
    expect(describeAgentTaskSchedule('0,20 * * * *', 'UTC')).toBe('0,20 * * * * (UTC)');
    expect(describeAgentTaskSchedule('*/7 * * * *', 'UTC')).toBe('*/7 * * * * (UTC)');
    expect(describeAgentTaskSchedule('0,30 9 * * *', 'UTC')).toBe('0,30 9 * * * (UTC)');
  });

  it('offers unique five-field presets', () => {
    const crons = agentTaskSchedulePresets().map((preset) => preset.cron);

    expect(new Set(crons).size).toBe(crons.length);
    expect(crons.every((cron) => cron.split(' ').length === 5)).toBe(true);
  });

  it('gives tasks a readable State: approval first, then paused, then the last run', () => {
    expect(agentTaskState({ approvalStatus: 'pending', enabled: true, lastRunStatus: 'failed' })).toEqual(
      expect.objectContaining({ label: 'Awaiting approval', tone: 'warning' }),
    );
    expect(agentTaskState({ approvalStatus: 'approved', enabled: false, lastRunStatus: 'failed' })).toEqual(
      expect.objectContaining({ label: 'Paused', tone: 'neutral' }),
    );
    expect(agentTaskState({ approvalStatus: 'approved', enabled: true, lastRunStatus: 'failed' })).toEqual(
      expect.objectContaining({ label: 'Failed', tone: 'danger' }),
    );
    expect(agentTaskRunState(null)).toEqual(expect.objectContaining({ label: 'Not run yet', tone: 'neutral' }));
  });
});
