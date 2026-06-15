import type { TicketAutomationState } from './ticket-automation.reducer';
import {
  selectTicketAutomationConfig,
  selectTicketAutomationError,
  selectTicketAutomationLoadingConfig,
  selectTicketAutomationRuns,
  selectTicketAutomationState,
} from './ticket-automation.selectors';

describe('ticketAutomation selectors', () => {
  const mockState: TicketAutomationState = {
    activeTicketId: 't1',
    config: null,
    runs: [],
    runDetail: null,
    runCacheByRunId: {},
    loadingConfig: true,
    loadingRuns: false,
    loadingRunDetail: false,
    saving: false,
    error: 'err',
  };

  it('selectTicketAutomationState projects slice', () => {
    expect(selectTicketAutomationState.projector(mockState)).toBe(mockState);
  });

  it('selectTicketAutomationLoadingConfig', () => {
    expect(selectTicketAutomationLoadingConfig.projector(mockState)).toBe(true);
  });

  it('selectTicketAutomationRuns', () => {
    expect(selectTicketAutomationRuns.projector(mockState)).toEqual([]);
  });

  it('selectTicketAutomationConfig', () => {
    expect(selectTicketAutomationConfig.projector(mockState)).toBeNull();
  });

  it('selectTicketAutomationError', () => {
    expect(selectTicketAutomationError.projector(mockState)).toBe('err');
  });
});
