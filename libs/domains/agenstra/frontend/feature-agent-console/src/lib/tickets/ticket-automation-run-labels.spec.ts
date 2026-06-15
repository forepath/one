import {
  ticketAutomationCancellationReasonLabel,
  ticketAutomationFailureCodeLabel,
  ticketAutomationRunPhaseLabel,
  ticketAutomationRunStatusLabel,
  ticketAutomationRunStepKindLabel,
} from './ticket-automation-run-labels';

describe('ticket-automation-run-labels', () => {
  it('maps run status away from raw snake_case where applicable', () => {
    expect(ticketAutomationRunStatusLabel('timed_out')).not.toBe('timed_out');
  });

  it('maps phase away from raw API token', () => {
    expect(ticketAutomationRunPhaseLabel('agent_loop')).not.toBe('agent_loop');
  });

  it('maps step kind away from raw API token', () => {
    expect(ticketAutomationRunStepKindLabel('vcs_prepare')).not.toBe('vcs_prepare');
  });

  it('maps failure code away from raw API token', () => {
    expect(ticketAutomationFailureCodeLabel('approval_missing')).not.toBe('approval_missing');
  });

  it('maps cancellation reason away from raw API token', () => {
    expect(ticketAutomationCancellationReasonLabel('lease_expired')).not.toBe('lease_expired');
  });

  it('passes through unknown codes unchanged', () => {
    expect(ticketAutomationRunStatusLabel('future_status')).toBe('future_status');
    expect(ticketAutomationRunStepKindLabel('future_kind')).toBe('future_kind');
  });
});
