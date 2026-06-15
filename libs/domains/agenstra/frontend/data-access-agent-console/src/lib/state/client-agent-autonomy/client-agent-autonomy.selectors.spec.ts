import type { ClientAgentAutonomyState } from './client-agent-autonomy.reducer';
import {
  selectClientAgentAutonomy,
  selectClientAgentAutonomyContext,
  selectClientAgentAutonomyError,
  selectClientAgentAutonomyLoading,
  selectClientAgentAutonomyState,
} from './client-agent-autonomy.selectors';

describe('clientAgentAutonomy selectors', () => {
  const mockState: ClientAgentAutonomyState = {
    clientId: 'c1',
    agentId: 'a1',
    autonomy: null,
    loading: true,
    saving: false,
    error: 'x',
  };

  it('selectClientAgentAutonomyState', () => {
    expect(selectClientAgentAutonomyState.projector(mockState)).toBe(mockState);
  });

  it('selectClientAgentAutonomyContext', () => {
    expect(selectClientAgentAutonomyContext.projector(mockState)).toEqual({ clientId: 'c1', agentId: 'a1' });
  });

  it('selectClientAgentAutonomyLoading', () => {
    expect(selectClientAgentAutonomyLoading.projector(mockState)).toBe(true);
  });

  it('selectClientAgentAutonomyError', () => {
    expect(selectClientAgentAutonomyError.projector(mockState)).toBe('x');
  });

  it('selectClientAgentAutonomy', () => {
    expect(selectClientAgentAutonomy.projector(mockState)).toBeNull();
  });
});
