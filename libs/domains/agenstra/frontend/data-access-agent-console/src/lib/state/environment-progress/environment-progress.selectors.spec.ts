import type { AgentResponseDto } from '../agents/agents.types';

import {
  selectClientEnvironmentProgressByAgentId,
  selectCreateEnvironmentProgress,
  selectEnvironmentProgressForAgent,
  selectClientPendingEnvironmentProgress,
  selectEnvironmentProgressByClientId,
  selectWorkspaceEnvironmentProgress,
  selectWorkspaceEnvironmentProgressByClientId,
} from './environment-progress.selectors';
import type { EnvironmentProgress } from './environment-progress.types';

function op(overrides: Partial<EnvironmentProgress> = {}): EnvironmentProgress {
  return {
    operationId: 'op-1',
    agentId: 'agent-1',
    agentName: 'Agent',
    operation: 'update',
    status: 'running',
    step: 'recreatingContainer',
    stepIndex: 1,
    stepCount: 3,
    progress: 50,
    startedAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:10Z',
    ...overrides,
  };
}

describe('environment-progress selectors', () => {
  describe('selectEnvironmentProgressByClientId', () => {
    const polled = { 'client-1': [op({ operationId: 'polled' })], 'client-2': [op({ operationId: 'other' })] };

    it('should use polled data when the selected workspace is not loaded live', () => {
      const result = selectEnvironmentProgressByClientId.projector({}, {}, polled, 'client-1');

      expect(result['client-1'][0].operationId).toBe('polled');
      expect(result['client-2'][0].operationId).toBe('other');
    });

    it('should prefer live data for the selected workspace once loaded', () => {
      const live = { 'client-1': { live: op({ operationId: 'live' }) } };
      const result = selectEnvironmentProgressByClientId.projector(live, { 'client-1': true }, polled, 'client-1');

      expect(result['client-1'].map((o) => o.operationId)).toEqual(['live']);
      expect(result['client-2'][0].operationId).toBe('other');
    });

    it('should drop the selected workspace when live data is empty', () => {
      const result = selectEnvironmentProgressByClientId.projector(
        { 'client-1': {} },
        { 'client-1': true },
        polled,
        'client-1',
      );

      expect(result['client-1']).toBeUndefined();
    });

    it('should ignore live data of workspaces that are not selected', () => {
      const live = { 'client-1': { live: op({ operationId: 'live' }) } };
      const result = selectEnvironmentProgressByClientId.projector(live, { 'client-1': true }, polled, 'client-2');

      expect(result['client-1'][0].operationId).toBe('polled');
    });
  });

  it('should aggregate per workspace', () => {
    const result = selectWorkspaceEnvironmentProgressByClientId.projector({
      'client-1': [op({ progress: 20 }), op({ operationId: 'op-2', progress: 40 })],
    });

    expect(result['client-1'].average).toBe(30);
    expect(result['client-1'].segments).toHaveLength(2);
  });

  it('should select a workspace aggregate or null', () => {
    const selector = selectWorkspaceEnvironmentProgress('client-1');

    expect(selector.projector({})).toBeNull();
  });

  it('should index operations by agent id', () => {
    const result = selectClientEnvironmentProgressByAgentId('client-1').projector([op()]);

    expect(result['agent-1'].operationId).toBe('op-1');
  });

  it('should select operations of environments missing from the list as pending', () => {
    const agents = { 'client-1': [{ id: 'agent-1' } as AgentResponseDto] };
    const result = selectClientPendingEnvironmentProgress('client-1').projector(
      [op(), op({ operationId: 'new', agentId: null }), op({ operationId: 'synced', agentId: 'agent-9' })],
      agents,
    );

    expect(result.map((o) => o.operationId)).toEqual(['new', 'synced']);
  });

  it('should select the operation of one environment or null', () => {
    const selector = selectEnvironmentProgressForAgent('client-1', 'agent-1');

    expect(selector.projector({ 'agent-1': op() })?.operationId).toBe('op-1');
    expect(selector.projector({})).toBeNull();
  });

  it('should select the running create operation by name', () => {
    const selector = selectCreateEnvironmentProgress('client-1', 'New');

    expect(
      selector.projector([op({ operationId: 'create', operation: 'create', agentName: 'New', agentId: null })])
        ?.operationId,
    ).toBe('create');
    expect(selector.projector([op()])).toBeNull();
  });
});
