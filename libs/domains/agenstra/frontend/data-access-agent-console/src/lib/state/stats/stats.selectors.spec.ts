import { initialStatsState, type StatsState } from './stats.reducer';
import {
  selectContainerStats,
  selectContainerStatsCount,
  selectContainerStatsFiltered,
  selectContainerStatsFromTime,
  selectContainerStatsInRange,
  selectContainerStatsLimited,
  selectContainersWithStats,
  selectCurrentContainerStats,
  selectStatsByContainer,
  selectStatsState,
} from './stats.selectors';
import type { ContainerStatsEntry } from './stats.types';

describe('Stats Selectors', () => {
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
  const createEntry = (
    clientId: string,
    agentId: string,
    timestamp: string,
    receivedAt: number,
  ): ContainerStatsEntry => ({
    status: { running: true },
    stats: mockStats,
    timestamp,
    receivedAt,
    clientId,
    agentId,
  });
  const createState = (overrides?: Partial<StatsState>): StatsState => ({
    ...initialStatsState,
    ...overrides,
  });

  describe('selectStatsState', () => {
    it('should select the stats feature state', () => {
      const state = createState();
      const rootState = { stats: state };
      const result = selectStatsState(rootState as any);

      expect(result).toEqual(state);
    });
  });

  describe('selectStatsByContainer', () => {
    it('should select stats by container', () => {
      const statsByContainer = {
        'client-1:agent-1': [createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000)],
        'client-1:agent-2': [createEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000)],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const result = selectStatsByContainer(rootState as any);

      expect(result).toEqual(statsByContainer);
    });
  });

  describe('selectContainerStats', () => {
    it('should select stats for a specific container', () => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const statsByContainer = {
        'client-1:agent-1': [entry1, entry2],
        'client-1:agent-2': [createEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 3000)],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const selector = selectContainerStats('client-1', 'agent-1');
      const result = selector(rootState as any);

      expect(result).toEqual([entry1, entry2]);
    });

    it('should return empty array for container with no stats', () => {
      const state = createState();
      const rootState = { stats: state };
      const selector = selectContainerStats('client-1', 'agent-1');
      const result = selector(rootState as any);

      expect(result).toEqual([]);
    });
  });

  describe('selectCurrentContainerStats', () => {
    it('should select the most recent stats for a container', () => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);
      const statsByContainer = {
        'client-1:agent-1': [entry1, entry2, entry3],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const selector = selectCurrentContainerStats('client-1', 'agent-1');
      const result = selector(rootState as any);

      expect(result).toEqual(entry3);
    });

    it('should return null for container with no stats', () => {
      const state = createState();
      const rootState = { stats: state };
      const selector = selectCurrentContainerStats('client-1', 'agent-1');
      const result = selector(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectContainerStatsInRange', () => {
    it('should select stats within a time range', () => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);
      const entry4 = createEntry('client-1', 'agent-1', '2024-01-01T00:15:00.000Z', 4000);
      const statsByContainer = {
        'client-1:agent-1': [entry1, entry2, entry3, entry4],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      // Select entries between 00:05 and 00:10
      const startTime = new Date('2024-01-01T00:05:00.000Z').getTime();
      const endTime = new Date('2024-01-01T00:10:00.000Z').getTime();
      const selector = selectContainerStatsInRange('client-1', 'agent-1', startTime, endTime);
      const result = selector(rootState as any);

      expect(result).toEqual([entry2, entry3]);
    });

    it('should select stats from start time to now when endTime is null', () => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);
      const statsByContainer = {
        'client-1:agent-1': [entry1, entry2, entry3],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      // Mock Date.now() to return a time after entry3
      const originalNow = Date.now;

      Date.now = jest.fn(() => new Date('2024-01-01T00:20:00.000Z').getTime());

      const startTime = new Date('2024-01-01T00:05:00.000Z').getTime();
      const selector = selectContainerStatsInRange('client-1', 'agent-1', startTime, null);
      const result = selector(rootState as any);

      expect(result).toEqual([entry2, entry3]);

      Date.now = originalNow;
    });

    it('should handle ISO string timestamps', () => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const statsByContainer = {
        'client-1:agent-1': [entry1, entry2],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const selector = selectContainerStatsInRange(
        'client-1',
        'agent-1',
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:05:00.000Z',
      );
      const result = selector(rootState as any);

      expect(result).toEqual([entry1, entry2]);
    });
  });

  describe('selectContainerStatsFromTime', () => {
    it('should select stats from a start time to now', () => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);
      const statsByContainer = {
        'client-1:agent-1': [entry1, entry2, entry3],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const originalNow = Date.now;

      Date.now = jest.fn(() => new Date('2024-01-01T00:20:00.000Z').getTime());

      const startTime = new Date('2024-01-01T00:05:00.000Z').getTime();
      const selector = selectContainerStatsFromTime('client-1', 'agent-1', startTime);
      const result = selector(rootState as any);

      expect(result).toEqual([entry2, entry3]);

      Date.now = originalNow;
    });
  });

  describe('selectContainerStatsCount', () => {
    it('should return the count of stats for a container', () => {
      const statsByContainer = {
        'client-1:agent-1': [
          createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000),
          createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000),
          createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000),
        ],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const selector = selectContainerStatsCount('client-1', 'agent-1');
      const result = selector(rootState as any);

      expect(result).toBe(3);
    });

    it('should return 0 for container with no stats', () => {
      const state = createState();
      const rootState = { stats: state };
      const selector = selectContainerStatsCount('client-1', 'agent-1');
      const result = selector(rootState as any);

      expect(result).toBe(0);
    });
  });

  describe('selectContainersWithStats', () => {
    it('should return all container keys that have stats', () => {
      const statsByContainer = {
        'client-1:agent-1': [createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000)],
        'client-1:agent-2': [createEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000)],
        'client-2:agent-1': [createEntry('client-2', 'agent-1', '2024-01-01T00:00:00.000Z', 3000)],
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const result = selectContainersWithStats(rootState as any);

      expect(result).toEqual(['client-1:agent-1', 'client-1:agent-2', 'client-2:agent-1']);
    });

    it('should return empty array when no containers have stats', () => {
      const state = createState();
      const rootState = { stats: state };
      const result = selectContainersWithStats(rootState as any);

      expect(result).toEqual([]);
    });
  });

  describe('selectContainerStatsLimited', () => {
    it('should return limited number of most recent stats', () => {
      const entries = [
        createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:15:00.000Z', 4000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:20:00.000Z', 5000),
      ];
      const statsByContainer = {
        'client-1:agent-1': entries,
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const selector = selectContainerStatsLimited('client-1', 'agent-1', 3);
      const result = selector(rootState as any);

      expect(result).toEqual([entries[2], entries[3], entries[4]]);
    });
  });

  describe('selectContainerStatsFiltered', () => {
    it('should filter stats by predicate', () => {
      const entries = [
        createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000),
      ];
      const statsByContainer = {
        'client-1:agent-1': entries,
      };
      const state = createState({ statsByContainer });
      const rootState = { stats: state };
      const selector = selectContainerStatsFiltered('client-1', 'agent-1', (entry) => entry.receivedAt >= 2000);
      const result = selector(rootState as any);

      expect(result).toEqual([entries[1], entries[2]]);
    });
  });
});
