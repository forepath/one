import {
  approveTicketAutomation,
  approveTicketAutomationFailure,
  approveTicketAutomationSuccess,
  cancelTicketAutomationRunFailure,
  cancelTicketAutomationRunSuccess,
  clearTicketAutomation,
  loadTicketAutomation,
  loadTicketAutomationFailure,
  loadTicketAutomationRunDetail,
  loadTicketAutomationRunDetailFailure,
  loadTicketAutomationRunDetailSuccess,
  loadTicketAutomationRunsFailure,
  loadTicketAutomationRunsSuccess,
  patchTicketAutomation,
  patchTicketAutomationFailure,
  patchTicketAutomationSuccess,
  ticketBoardAutomationRunStepAppended,
  ticketBoardAutomationRunUpsert,
  ticketBoardAutomationUpsert,
  unapproveTicketAutomation,
  unapproveTicketAutomationFailure,
  unapproveTicketAutomationSuccess,
} from './ticket-automation.actions';
import {
  initialTicketAutomationState,
  ticketAutomationReducer,
  type TicketAutomationState,
} from './ticket-automation.reducer';
import type { TicketAutomationResponseDto, TicketAutomationRunResponseDto } from './ticket-automation.types';

describe('ticketAutomationReducer', () => {
  const mockConfig: TicketAutomationResponseDto = {
    ticketId: 't1',
    eligible: true,
    allowedAgentIds: ['a1'],
    includeWorkspaceContext: true,
    contextEnvironmentIds: [],
    autoEnrichmentEnabled: true,
    verifierProfile: null,
    requiresApproval: false,
    approvedAt: null,
    approvedByUserId: null,
    approvalBaselineTicketUpdatedAt: null,
    defaultBranchOverride: null,
    automationBranchStrategy: 'reuse_per_ticket',
    forceNewAutomationBranchNextRun: false,
    nextRetryAt: null,
    consecutiveFailureCount: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockRun: TicketAutomationRunResponseDto = {
    id: 'r1',
    ticketId: 't1',
    clientId: 'c1',
    agentId: 'a1',
    status: 'running',
    phase: 'agent_loop',
    ticketStatusBefore: 'todo',
    branchName: 'automation/x',
    baseBranch: 'main',
    baseSha: null,
    startedAt: '2024-01-01T00:00:00Z',
    finishedAt: null,
    updatedAt: '2024-01-01T00:00:00Z',
    iterationCount: 1,
    completionMarkerSeen: false,
    verificationPassed: null,
    failureCode: null,
    summary: null,
    cancelRequestedAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
  };

  it('returns initial state for unknown action', () => {
    const state = ticketAutomationReducer(undefined, { type: 'UNKNOWN' } as never);

    expect(state).toEqual(initialTicketAutomationState);
  });

  it('clears runs and config when loading a different ticket', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      activeTicketId: 't1',
      config: mockConfig,
      runs: [mockRun],
    };
    const next = ticketAutomationReducer(prev, loadTicketAutomation({ ticketId: 't2' }));

    expect(next.activeTicketId).toBe('t2');
    expect(next.loadingConfig).toBe(true);
    expect(next.runs).toEqual([]);
    expect(next.config).toBeNull();
    expect(next.runDetail).toBeNull();
  });

  it('merges run into list on detail success and cancel success', () => {
    let state = ticketAutomationReducer(
      initialTicketAutomationState,
      loadTicketAutomationRunsSuccess({ runs: [{ ...mockRun, id: 'r-old' }] }),
    );
    const updated = { ...mockRun, id: 'r-old', status: 'cancelled' as const };

    state = ticketAutomationReducer(state, cancelTicketAutomationRunSuccess({ run: updated }));
    expect(state.runs).toEqual([updated]);
    expect(state.saving).toBe(false);
  });

  it('handles patch, approve and unapprove success', () => {
    let state = ticketAutomationReducer(
      initialTicketAutomationState,
      patchTicketAutomation({ ticketId: 't1', dto: {} }),
    );

    expect(state.saving).toBe(true);
    state = ticketAutomationReducer(state, patchTicketAutomationSuccess({ config: mockConfig }));
    expect(state.saving).toBe(false);
    expect(state.config).toEqual(mockConfig);
    state = ticketAutomationReducer(state, approveTicketAutomation({ ticketId: 't1' }));
    state = ticketAutomationReducer(
      state,
      approveTicketAutomationSuccess({ config: { ...mockConfig, approvedAt: 'x' } }),
    );
    expect(state.config?.approvedAt).toBe('x');
    state = ticketAutomationReducer(state, unapproveTicketAutomation({ ticketId: 't1' }));
    state = ticketAutomationReducer(
      state,
      unapproveTicketAutomationSuccess({ config: { ...mockConfig, approvedAt: null } }),
    );
    expect(state.config?.approvedAt).toBeNull();
  });

  it('clears on clearTicketAutomation', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      config: mockConfig,
      error: 'x',
    };
    const next = ticketAutomationReducer(prev, clearTicketAutomation());

    expect(next).toEqual(initialTicketAutomationState);
  });

  it('records failures', () => {
    expect(
      ticketAutomationReducer(initialTicketAutomationState, loadTicketAutomationFailure({ error: 'e' })).error,
    ).toBe('e');
    expect(
      ticketAutomationReducer(initialTicketAutomationState, loadTicketAutomationRunsFailure({ error: 'r' })).error,
    ).toBe('r');
    expect(
      ticketAutomationReducer(initialTicketAutomationState, loadTicketAutomationRunDetailFailure({ error: 'd' })).error,
    ).toBe('d');
    expect(
      ticketAutomationReducer(
        { ...initialTicketAutomationState, saving: true },
        patchTicketAutomationFailure({ error: 'p' }),
      ).error,
    ).toBe('p');
    expect(
      ticketAutomationReducer(
        { ...initialTicketAutomationState, saving: true },
        approveTicketAutomationFailure({ error: 'a' }),
      ).error,
    ).toBe('a');
    expect(
      ticketAutomationReducer(
        { ...initialTicketAutomationState, saving: true },
        unapproveTicketAutomationFailure({ error: 'u' }),
      ).error,
    ).toBe('u');
    expect(
      ticketAutomationReducer(
        { ...initialTicketAutomationState, saving: true },
        cancelTicketAutomationRunFailure({ error: 'c' }),
      ).error,
    ).toBe('c');
  });

  it('sets loading flags for run detail', () => {
    let state = ticketAutomationReducer(
      initialTicketAutomationState,
      loadTicketAutomationRunDetail({ ticketId: 't1', runId: 'r1' }),
    );

    expect(state.loadingRunDetail).toBe(true);
    state = ticketAutomationReducer(state, loadTicketAutomationRunDetailSuccess({ run: mockRun }));
    expect(state.loadingRunDetail).toBe(false);
    expect(state.runDetail).toEqual(mockRun);
  });

  it('merges config from board socket upsert for active ticket', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      activeTicketId: 't1',
      config: { ...mockConfig, eligible: false },
    };
    const next = ticketAutomationReducer(
      prev,
      ticketBoardAutomationUpsert({ config: { ...mockConfig, eligible: true } }),
    );

    expect(next.config?.eligible).toBe(true);
  });

  it('ignores board socket config upsert for a different ticket', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      activeTicketId: 't1',
      config: mockConfig,
    };
    const next = ticketAutomationReducer(
      prev,
      ticketBoardAutomationUpsert({
        config: { ...mockConfig, ticketId: 'other' },
      }),
    );

    expect(next.config?.ticketId).toBe('t1');
  });

  it('merges run from board socket upsert', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      activeTicketId: 't1',
      runs: [],
      runDetail: mockRun,
    };
    const updated = { ...mockRun, phase: 'verify' as const };
    const next = ticketAutomationReducer(prev, ticketBoardAutomationRunUpsert({ run: updated }));

    expect(next.runs[0].phase).toBe('verify');
    expect(next.runDetail?.phase).toBe('verify');
    expect(next.runCacheByRunId[mockRun.id]?.phase).toBe('verify');
  });

  it('caches board run upsert globally when not the active ticket', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      activeTicketId: 'other-ticket',
      runs: [],
    };
    const next = ticketAutomationReducer(prev, ticketBoardAutomationRunUpsert({ run: mockRun }));

    expect(next.runs).toEqual([]);
    expect(next.runCacheByRunId[mockRun.id]?.id).toBe(mockRun.id);
  });

  it('appends a step to open run detail from board socket', () => {
    const prev: TicketAutomationState = {
      ...initialTicketAutomationState,
      activeTicketId: 't1',
      runs: [mockRun],
      runDetail: { ...mockRun, steps: [] },
    };
    const step = {
      id: 's1',
      stepIndex: 0,
      phase: 'agent_loop',
      kind: 'agent_turn',
      payload: null,
      excerpt: null,
      createdAt: '2024-01-01T00:01:00Z',
    };
    const next = ticketAutomationReducer(prev, ticketBoardAutomationRunStepAppended({ runId: 'r1', step }));

    expect(next.runDetail?.steps).toEqual([step]);
  });
});
