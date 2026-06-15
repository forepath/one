import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';

import { clearAllStatsHistory, clearStatsHistory } from './stats.actions';
import { StatsFacade } from './stats.facade';
import type { StatsState } from './stats.reducer';
import type { ContainerStatsEntry } from './stats.types';

describe('StatsFacade', () => {
  let facade: StatsFacade;
  let store: MockStore<{ stats: StatsState }>;
  const initialState = {
    stats: {
      runningOverrides: {},
      statsByContainer: {},
      maxEntriesPerContainer: 1000,
    },
  };
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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StatsFacade, provideMockStore({ initialState })],
    });

    facade = TestBed.inject(StatsFacade);
    store = TestBed.inject(MockStore);
  });

  describe('getContainerStats$', () => {
    it('should return stats for a container', (done) => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);

      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': [entry1, entry2],
          },
          maxEntriesPerContainer: 1000,
        },
      });

      facade.getContainerStats$('client-1', 'agent-1').subscribe((stats) => {
        expect(stats).toEqual([entry1, entry2]);
        done();
      });
    });

    it('should return empty array for container with no stats', (done) => {
      facade.getContainerStats$('client-1', 'agent-1').subscribe((stats) => {
        expect(stats).toEqual([]);
        done();
      });
    });
  });

  describe('getCurrentContainerStats$', () => {
    it('should return the most recent stats for a container', (done) => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);

      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': [entry1, entry2],
          },
          maxEntriesPerContainer: 1000,
        },
      });

      facade.getCurrentContainerStats$('client-1', 'agent-1').subscribe((stats) => {
        expect(stats).toEqual(entry2);
        done();
      });
    });

    it('should return null for container with no stats', (done) => {
      facade.getCurrentContainerStats$('client-1', 'agent-1').subscribe((stats) => {
        expect(stats).toBeNull();
        done();
      });
    });
  });

  describe('getContainerStatsInRange$', () => {
    it('should return stats within a time range', (done) => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);

      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': [entry1, entry2, entry3],
          },
          maxEntriesPerContainer: 1000,
        },
      });

      const startTime = new Date('2024-01-01T00:05:00.000Z').getTime();
      const endTime = new Date('2024-01-01T00:10:00.000Z').getTime();

      facade.getContainerStatsInRange$('client-1', 'agent-1', startTime, endTime).subscribe((stats) => {
        expect(stats).toEqual([entry2, entry3]);
        done();
      });
    });
  });

  describe('getContainerStatsFromTime$', () => {
    it('should return stats from a start time to now', (done) => {
      const entry1 = createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000);
      const entry2 = createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000);
      const entry3 = createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000);

      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': [entry1, entry2, entry3],
          },
          maxEntriesPerContainer: 1000,
        },
      });

      const startTime = new Date('2024-01-01T00:05:00.000Z').getTime();
      const originalNow = Date.now;

      Date.now = jest.fn(() => new Date('2024-01-01T00:20:00.000Z').getTime());

      facade.getContainerStatsFromTime$('client-1', 'agent-1', startTime).subscribe((stats) => {
        expect(stats).toEqual([entry2, entry3]);
        Date.now = originalNow;
        done();
      });
    });
  });

  describe('getContainerStatsCount$', () => {
    it('should return the count of stats for a container', (done) => {
      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': [
              createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000),
              createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000),
              createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000),
            ],
          },
          maxEntriesPerContainer: 1000,
        },
      });

      facade.getContainerStatsCount$('client-1', 'agent-1').subscribe((count) => {
        expect(count).toBe(3);
        done();
      });
    });
  });

  describe('getContainersWithStats$', () => {
    it('should return all container keys that have stats', (done) => {
      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': [createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000)],
            'client-1:agent-2': [createEntry('client-1', 'agent-2', '2024-01-01T00:00:00.000Z', 2000)],
          },
          maxEntriesPerContainer: 1000,
        },
      });

      facade.getContainersWithStats$().subscribe((containers) => {
        expect(containers).toEqual(['client-1:agent-1', 'client-1:agent-2']);
        done();
      });
    });
  });

  describe('getContainerStatsLimited$', () => {
    it('should return limited number of most recent stats', (done) => {
      const entries = [
        createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:15:00.000Z', 4000),
      ];

      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': entries,
          },
          maxEntriesPerContainer: 1000,
        },
      });

      facade.getContainerStatsLimited$('client-1', 'agent-1', 2).subscribe((stats) => {
        expect(stats).toEqual([entries[2], entries[3]]);
        done();
      });
    });
  });

  describe('getContainerStatsFiltered$', () => {
    it('should filter stats by predicate', (done) => {
      const entries = [
        createEntry('client-1', 'agent-1', '2024-01-01T00:00:00.000Z', 1000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:05:00.000Z', 2000),
        createEntry('client-1', 'agent-1', '2024-01-01T00:10:00.000Z', 3000),
      ];

      store.setState({
        stats: {
          runningOverrides: {},
          statsByContainer: {
            'client-1:agent-1': entries,
          },
          maxEntriesPerContainer: 1000,
        },
      });

      facade
        .getContainerStatsFiltered$('client-1', 'agent-1', (entry) => entry.receivedAt >= 2000)
        .subscribe((stats) => {
          expect(stats).toEqual([entries[1], entries[2]]);
          done();
        });
    });
  });

  describe('clearStatsHistory', () => {
    it('should dispatch clearStatsHistory action', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      facade.clearStatsHistory('client-1', 'agent-1');

      expect(dispatchSpy).toHaveBeenCalledWith(clearStatsHistory({ clientId: 'client-1', agentId: 'agent-1' }));
    });
  });

  describe('clearAllStatsHistory', () => {
    it('should dispatch clearAllStatsHistory action', () => {
      const dispatchSpy = jest.spyOn(store, 'dispatch');

      facade.clearAllStatsHistory();

      expect(dispatchSpy).toHaveBeenCalledWith(clearAllStatsHistory());
    });
  });
});
