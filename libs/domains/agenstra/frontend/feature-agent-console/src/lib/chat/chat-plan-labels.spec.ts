import { chatPlanStateBadgeColor, chatPlanStateLabel } from './chat-plan-labels';

describe('chatPlanStateLabel', () => {
  it('returns a consolidated label for draft plans that are not ready to execute', () => {
    expect(chatPlanStateLabel('ready', 'draft')).toBe('Draft available');
  });

  it('falls back to the status label for regular ready plans', () => {
    expect(chatPlanStateLabel('ready', 'ready')).toBe('Ready');
  });

  it('falls back to whichever raw value is available for unknown states', () => {
    expect(chatPlanStateLabel('custom-status', 'custom-phase')).toBe('custom-phase');
    expect(chatPlanStateLabel('custom-status', '')).toBe('custom-status');
  });
});

describe('chatPlanStateBadgeColor', () => {
  it('maps successful terminal states to success badges', () => {
    expect(chatPlanStateBadgeColor('ready', 'ready')).toBe('success');
    expect(chatPlanStateBadgeColor('executed', 'ready')).toBe('success');
  });

  it('maps error states to danger badges', () => {
    expect(chatPlanStateBadgeColor('failed', 'ready')).toBe('danger');
    expect(chatPlanStateBadgeColor('cancelled', 'ready')).toBe('danger');
  });

  it('maps in-progress states to secondary/warning badges', () => {
    expect(chatPlanStateBadgeColor('executing', 'ready')).toBe('warning');
    expect(chatPlanStateBadgeColor('exploring', 'explore')).toBe('secondary');
    expect(chatPlanStateBadgeColor('ready', 'draft')).toBe('info');
  });
});
