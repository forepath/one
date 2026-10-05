import {
  coerceAutomationTurnStatus,
  extractAutomationTurnStatus,
  isAutomationTurnComplete,
} from './automation-turn-status';

describe('automation-turn-status', () => {
  it('extracts status from result automationTurnStatus', () => {
    expect(
      extractAutomationTurnStatus({
        success: true,
        data: {
          from: 'agent',
          response: { type: 'result', result: 'done', automationTurnStatus: 'complete' },
        },
      }),
    ).toBe('complete');
  });

  it('does not treat free-form result text as status', () => {
    expect(
      extractAutomationTurnStatus({
        success: true,
        data: {
          from: 'agent',
          response: { type: 'result', result: 'complete' },
        },
      }),
    ).toBeUndefined();
  });

  it('extracts status from agenstra_turn parts', () => {
    expect(
      extractAutomationTurnStatus({
        success: true,
        data: {
          from: 'agent',
          response: {
            type: 'agenstra_turn',
            parts: [{ type: 'result', result: 'ok', automationTurnStatus: 'continue' }],
          },
        },
      }),
    ).toBe('continue');
  });

  it('coerces and detects complete', () => {
    expect(coerceAutomationTurnStatus({ status: 'complete' })).toBe('complete');
    expect(isAutomationTurnComplete('complete')).toBe(true);
    expect(isAutomationTurnComplete('continue')).toBe(false);
  });
});
