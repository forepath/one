import {
  agentTaskRunStatusBadgeColor,
  agentTaskRunStatusLabel,
  agentTaskRunTriggerLabel,
  agentTaskSchedulePresets,
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
    expect(describeAgentTaskSchedule('15 3 * * 2', 'UTC')).toBe('15 3 * * 2 (UTC)');
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
});
