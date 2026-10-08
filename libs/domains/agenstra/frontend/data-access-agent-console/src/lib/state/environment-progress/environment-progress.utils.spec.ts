import type { EnvironmentProgress } from './environment-progress.types';
import {
  buildWorkspaceEnvironmentProgress,
  findCreateEnvironmentProgress,
  indexEnvironmentProgressByAgentId,
  sortEnvironmentProgress,
} from './environment-progress.utils';

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
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('environment-progress utils', () => {
  describe('sortEnvironmentProgress', () => {
    it('should sort by start time, then operation id', () => {
      const a = op({ operationId: 'b', startedAt: '2024-01-01T00:00:00Z' });
      const b = op({ operationId: 'a', startedAt: '2024-01-01T00:00:00Z' });
      const c = op({ operationId: 'c', startedAt: '2023-12-31T00:00:00Z' });

      expect(sortEnvironmentProgress([a, b, c]).map((o) => o.operationId)).toEqual(['c', 'a', 'b']);
    });
  });

  describe('buildWorkspaceEnvironmentProgress', () => {
    it('should return null without operations', () => {
      expect(buildWorkspaceEnvironmentProgress('client-1', [])).toBeNull();
    });

    it('should compute the average and proportional stacked segments', () => {
      const result = buildWorkspaceEnvironmentProgress('client-1', [
        op({ operationId: 'op-1', progress: 50 }),
        op({ operationId: 'op-2', agentId: 'agent-2', progress: 25, startedAt: '2024-01-01T00:00:01Z' }),
      ]);

      expect(result?.clientId).toBe('client-1');
      expect(result?.average).toBe(38);
      expect(result?.segments.map((s) => [s.operationId, s.progress, s.value])).toEqual([
        ['op-1', 50, 25],
        ['op-2', 25, 12.5],
      ]);
      expect(result?.operations).toHaveLength(2);
    });

    it('should clamp invalid progress values', () => {
      const result = buildWorkspaceEnvironmentProgress('client-1', [op({ progress: 150 }), op({ progress: NaN })]);

      expect(result?.segments.map((s) => s.progress)).toEqual([100, 0]);
      expect(result?.average).toBe(50);
    });
  });

  describe('indexEnvironmentProgressByAgentId', () => {
    it('should index by agent id, skip operations without agent and prefer the newest operation', () => {
      const result = indexEnvironmentProgressByAgentId([
        op({ operationId: 'newer', startedAt: '2024-01-01T00:00:05Z' }),
        op({ operationId: 'older', startedAt: '2024-01-01T00:00:00Z' }),
        op({ operationId: 'pending', agentId: null }),
      ]);

      expect(Object.keys(result)).toEqual(['agent-1']);
      expect(result['agent-1'].operationId).toBe('newer');
    });
  });

  describe('findCreateEnvironmentProgress', () => {
    it('should return null without a name', () => {
      expect(findCreateEnvironmentProgress([op({ operation: 'create' })], '  ')).toBeNull();
      expect(findCreateEnvironmentProgress([op({ operation: 'create' })], undefined)).toBeNull();
    });

    it('should match running creates by trimmed name and prefer the newest', () => {
      const result = findCreateEnvironmentProgress(
        [
          op({ operationId: 'old', operation: 'create', agentName: 'New', startedAt: '2024-01-01T00:00:00Z' }),
          op({ operationId: 'new', operation: 'create', agentName: 'New ', startedAt: '2024-01-01T00:00:05Z' }),
          op({ operationId: 'update', operation: 'update', agentName: 'New', startedAt: '2024-01-01T00:00:09Z' }),
          op({ operationId: 'other', operation: 'create', agentName: 'Other' }),
        ],
        ' New',
      );

      expect(result?.operationId).toBe('new');
    });

    it('should ignore finished operations', () => {
      expect(
        findCreateEnvironmentProgress([op({ operation: 'create', agentName: 'New', status: 'completed' })], 'New'),
      ).toBeNull();
    });
  });
});
