import {
  clearClientAgentAutonomy,
  loadClientAgentAutonomy,
  loadClientAgentAutonomyFailure,
  upsertClientAgentAutonomy,
  upsertClientAgentAutonomyFailure,
  upsertClientAgentAutonomySuccess,
} from './client-agent-autonomy.actions';
import {
  clientAgentAutonomyReducer,
  initialClientAgentAutonomyState,
  type ClientAgentAutonomyState,
} from './client-agent-autonomy.reducer';
import type { ClientAgentAutonomyResponseDto } from './client-agent-autonomy.types';

describe('clientAgentAutonomyReducer', () => {
  const mockAutonomy: ClientAgentAutonomyResponseDto = {
    clientId: 'c1',
    agentId: 'a1',
    enabled: true,
    preImproveTicket: false,
    maxRuntimeMs: 3_600_000,
    maxIterations: 20,
    tokenBudgetLimit: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('returns initial for unknown action', () => {
    expect(clientAgentAutonomyReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(
      initialClientAgentAutonomyState,
    );
  });

  it('clears autonomy when context changes on load', () => {
    const prev: ClientAgentAutonomyState = {
      ...initialClientAgentAutonomyState,
      clientId: 'c1',
      agentId: 'a1',
      autonomy: mockAutonomy,
    };
    const next = clientAgentAutonomyReducer(prev, loadClientAgentAutonomy({ clientId: 'c2', agentId: 'a1' }));

    expect(next.loading).toBe(true);
    expect(next.autonomy).toBeNull();
  });

  it('upsert flow', () => {
    let state = clientAgentAutonomyReducer(
      initialClientAgentAutonomyState,
      upsertClientAgentAutonomy({
        clientId: 'c1',
        agentId: 'a1',
        dto: {
          enabled: true,
          preImproveTicket: false,
          maxRuntimeMs: 3_600_000,
          maxIterations: 20,
        },
      }),
    );

    expect(state.saving).toBe(true);
    state = clientAgentAutonomyReducer(state, upsertClientAgentAutonomySuccess({ autonomy: mockAutonomy }));
    expect(state.saving).toBe(false);
    expect(state.autonomy).toEqual(mockAutonomy);
  });

  it('records failures', () => {
    expect(
      clientAgentAutonomyReducer(initialClientAgentAutonomyState, loadClientAgentAutonomyFailure({ error: 'e' })).error,
    ).toBe('e');
    expect(
      clientAgentAutonomyReducer(
        { ...initialClientAgentAutonomyState, saving: true },
        upsertClientAgentAutonomyFailure({ error: 'u' }),
      ).error,
    ).toBe('u');
  });

  it('clearClientAgentAutonomy resets', () => {
    const prev: ClientAgentAutonomyState = { ...initialClientAgentAutonomyState, autonomy: mockAutonomy };

    expect(clientAgentAutonomyReducer(prev, clearClientAgentAutonomy())).toEqual(initialClientAgentAutonomyState);
  });
});
