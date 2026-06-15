import { clearAllStatsHistory, clearStatsHistory, containerStatsReceived } from './stats.actions';
import { initialStatsState, statsReducer } from './stats.reducer';
import type { ContainerStatsEntry } from './stats.types';

describe('StatsReducer', () => {
  const mockStats = {
    read: '2024-01-01T00:00:00.000000000Z',
    preread: '2024-01-01T00:00:00.000000000Z',
    pids_stats: { current: 1 },
    blkio_stats: {},
    num_procs: 0,
    storage_stats: {},
    cpu_stats: {
      cpu_usage: {
        total_usage: 1000000000,
        percpu_usage: [1000000000],
        usage_in_kernelmode: 100000000,
        usage_in_usermode: 900000000,
      },
      system_cpu_usage: 2000000000,
      online_cpus: 1,
      throttled_data: {},
    },
    precpu_stats: {
      cpu_usage: {
        total_usage: 0,
        percpu_usage: [],
        usage_in_kernelmode: 0,
        usage_in_usermode: 0,
      },
      system_cpu_usage: 0,
      online_cpus: 1,
      throttled_data: {},
    },
    memory_stats: {
      usage: 1000000,
      max_usage: 2000000,
      stats: {},
    },
    networks: {},
  };
  const createMockEntry = (
    clientId: string,
    agentId: string,
    timestamp: string,
    receivedAt: number,
  ): ContainerStatsEntry => ({
    stats: mockStats,
    status: { running: true },
    timestamp,
    receivedAt,
    clientId,
    agentId,
  });

  describe('initial state', () => {
    it('should return the initial state', () => {
      const state = statsReducer(undefined, { type: '[Stats] Unknown' });

      expect(state).toEqual(initialStatsState);
    });
  });

  describe('containerStatsReceived', () => {
    it('should add stats entry for a container (clientId:agentId)', () => {
      const entry = createMockEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const state = statsReducer(initialStatsState, containerStatsReceived({ entry }));

      expect(state.statsByContainer['client-1:agent-1']).toHaveLength(1);
      expect(state.statsByContainer['client-1:agent-1'][0]).toEqual(entry);
    });

    it('should add multiple stats entries for the same container', () => {
      const entry1 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);
      let state = statsReducer(initialStatsState, containerStatsReceived({ entry: entry1 }));

      state = statsReducer(state, containerStatsReceived({ entry: entry2 }));
      state = statsReducer(state, containerStatsReceived({ entry: entry3 }));

      expect(state.statsByContainer['client-1:agent-1']).toHaveLength(3);
      expect(state.statsByContainer['client-1:agent-1'][0]).toEqual(entry1);
      expect(state.statsByContainer['client-1:agent-1'][1]).toEqual(entry2);
      expect(state.statsByContainer['client-1:agent-1'][2]).toEqual(entry3);
    });

    it('should add stats entries for different containers', () => {
      const entry1 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createMockEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000);
      const entry3 = createMockEntry('client-2', 'agent-1', '2024-01-01T00:00:00.000Z', 3000);
      let state = statsReducer(initialStatsState, containerStatsReceived({ entry: entry1 }));

      state = statsReducer(state, containerStatsReceived({ entry: entry2 }));
      state = statsReducer(state, containerStatsReceived({ entry: entry3 }));

      expect(state.statsByContainer['client-1:agent-1']).toHaveLength(1);
      expect(state.statsByContainer['client-1:agent-2']).toHaveLength(1);
      expect(state.statsByContainer['client-2:agent-1']).toHaveLength(1);
      expect(state.statsByContainer['client-1:agent-1'][0]).toEqual(entry1);
      expect(state.statsByContainer['client-1:agent-2'][0]).toEqual(entry2);
      expect(state.statsByContainer['client-2:agent-1'][0]).toEqual(entry3);
    });

    it('should limit entries per container to maxEntriesPerContainer', () => {
      const maxEntries = initialStatsState.maxEntriesPerContainer;
      const entries: ContainerStatsEntry[] = [];

      // Create more entries than the max
      for (let i = 0; i < maxEntries + 10; i++) {
        entries.push(
          createMockEntry('client-1', 'agent-1', `2024-01-01T00:${String(i).padStart(2, '0')}:00.000Z`, i * 1000),
        );
      }

      let state = initialStatsState;

      for (const entry of entries) {
        state = statsReducer(state, containerStatsReceived({ entry }));
      }

      expect(state.statsByContainer['client-1:agent-1']).toHaveLength(maxEntries);
      // Should keep the last maxEntries entries
      expect(state.statsByContainer['client-1:agent-1'][0]).toEqual(entries[10]); // First entry should be the 11th one
      expect(state.statsByContainer['client-1:agent-1'][maxEntries - 1]).toEqual(entries[entries.length - 1]);
    });
  });

  describe('clearStatsHistory', () => {
    it('should clear stats for a specific container', () => {
      const entry1 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createMockEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000);
      let state = statsReducer(initialStatsState, containerStatsReceived({ entry: entry1 }));

      state = statsReducer(state, containerStatsReceived({ entry: entry2 }));
      state = statsReducer(state, clearStatsHistory({ clientId: 'client-1', agentId: 'agent-1' }));

      expect(state.statsByContainer['client-1:agent-1']).toBeUndefined();
      expect(state.statsByContainer['client-1:agent-2']).toHaveLength(1);
    });

    it('should not affect other containers when clearing one', () => {
      const entry1 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createMockEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000);
      const entry3 = createMockEntry('client-2', 'agent-1', '2024-01-01T00:00:00.000Z', 3000);
      let state = statsReducer(initialStatsState, containerStatsReceived({ entry: entry1 }));

      state = statsReducer(state, containerStatsReceived({ entry: entry2 }));
      state = statsReducer(state, containerStatsReceived({ entry: entry3 }));
      state = statsReducer(state, clearStatsHistory({ clientId: 'client-1', agentId: 'agent-2' }));

      expect(state.statsByContainer['client-1:agent-1']).toHaveLength(1);
      expect(state.statsByContainer['client-1:agent-2']).toBeUndefined();
      expect(state.statsByContainer['client-2:agent-1']).toHaveLength(1);
    });

    it('should handle clearing non-existent container', () => {
      const state = statsReducer(
        initialStatsState,
        clearStatsHistory({ clientId: 'non-existent', agentId: 'non-existent' }),
      );

      expect(state.statsByContainer).toEqual({});
    });
  });

  describe('clearAllStatsHistory', () => {
    it('should clear all stats for all containers', () => {
      const entry1 = createMockEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createMockEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000);
      const entry3 = createMockEntry('client-2', 'agent-1', '2024-01-01T00:00:00.000Z', 3000);
      let state = statsReducer(initialStatsState, containerStatsReceived({ entry: entry1 }));

      state = statsReducer(state, containerStatsReceived({ entry: entry2 }));
      state = statsReducer(state, containerStatsReceived({ entry: entry3 }));
      state = statsReducer(state, clearAllStatsHistory());

      expect(state.statsByContainer).toEqual({});
    });

    it('should handle clearing when no stats exist', () => {
      const state = statsReducer(initialStatsState, clearAllStatsHistory());

      expect(state.statsByContainer).toEqual({});
    });
  });
});
