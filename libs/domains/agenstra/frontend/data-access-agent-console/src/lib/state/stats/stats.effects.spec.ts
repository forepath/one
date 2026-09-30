import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, toArray } from 'rxjs';

import { selectSelectedAgentId, selectSelectedClientId } from '../container-socket/container-socket.selectors';
import type { ContainerStatsPayload, SuccessResponse } from '../container-socket/container-socket.types';

import { containerStatsReceived } from './stats.actions';
import { mapContainerStatsTick$ } from './stats.effects';
import { selectStatsByContainer } from './stats.selectors';
import { buildContainerStatsEntry, isRedundantContainerStats } from './stats.utils';
import type { ContainerStatsEntry } from './stats.types';

describe('StatsEffects / stats utils', () => {
  let store: MockStore;
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

  const createContainerStatsPayload = (
    overrides: Partial<ContainerStatsPayload> = {},
  ): SuccessResponse<ContainerStatsPayload> => ({
    success: true,
    data: {
      status: { running: true },
      stats: mockStats,
      timestamp: '2024-01-01T00:00:00.000Z',
      ...overrides,
    },
    timestamp: '2024-01-01T00:00:00.000Z',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [
            { selector: selectSelectedClientId, value: 'client-1' },
            { selector: selectSelectedAgentId, value: 'agent-1' },
            { selector: selectStatsByContainer, value: {} },
          ],
        }),
      ],
    });

    store = TestBed.inject(MockStore);
  });

  describe('buildContainerStatsEntry', () => {
    it('should map payload and fall back to unknown ids', () => {
      const data = createContainerStatsPayload().data;

      expect(buildContainerStatsEntry(data, null, null, 42)).toEqual({
        stats: mockStats,
        status: { running: true },
        timestamp: '2024-01-01T00:00:00.000Z',
        receivedAt: 42,
        clientId: 'unknown',
        agentId: 'unknown',
      });
    });
  });

  describe('isRedundantContainerStats', () => {
    const runningEntry = (cpuTotal: number, memory: number): ContainerStatsEntry =>
      buildContainerStatsEntry(
        {
          status: { running: true },
          stats: {
            ...mockStats,
            cpu_stats: {
              ...mockStats.cpu_stats,
              cpu_usage: { ...mockStats.cpu_stats.cpu_usage, total_usage: cpuTotal },
            },
            memory_stats: { ...mockStats.memory_stats, usage: memory },
          },
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        'client-1',
        'agent-1',
        1,
      );

    const stoppedEntry = (): ContainerStatsEntry =>
      buildContainerStatsEntry(
        {
          status: { running: false },
          stats: mockStats,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        'client-1',
        'agent-1',
        1,
      );

    it('should not treat the first sample as redundant', () => {
      expect(isRedundantContainerStats(null, runningEntry(1, 1))).toBe(false);
    });

    it('should skip repeated stopped heartbeats', () => {
      expect(isRedundantContainerStats(stoppedEntry(), stoppedEntry())).toBe(true);
    });

    it('should keep running→stopped transitions', () => {
      expect(isRedundantContainerStats(runningEntry(1, 1), stoppedEntry())).toBe(false);
    });

    it('should keep running ticks when cpu/memory counters move', () => {
      expect(isRedundantContainerStats(runningEntry(1, 1), runningEntry(2, 1))).toBe(false);
    });

    it('should skip identical running ticks', () => {
      expect(isRedundantContainerStats(runningEntry(1, 1), runningEntry(1, 1))).toBe(true);
    });

    it('should keep running ticks when a status-only snapshot is followed by full stats', () => {
      const statusOnly = buildContainerStatsEntry(
        {
          agentId: 'agent-1',
          status: { running: true },
          stats: null,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        'client-1',
        'agent-1',
        1,
      );

      expect(isRedundantContainerStats(statusOnly, runningEntry(1, 1))).toBe(false);
    });

    it('should prefer payload agentId over selected agent id', () => {
      const entry = buildContainerStatsEntry(
        {
          agentId: 'payload-agent',
          status: { running: false },
          stats: null,
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        'client-1',
        'selected-agent',
        1,
      );

      expect(entry.agentId).toBe('payload-agent');
    });
  });

  describe('mapContainerStatsTick$', () => {
    it('should dispatch containerStatsReceived for a useful tick', async () => {
      const payload = createContainerStatsPayload();
      const actions = await firstValueFrom(mapContainerStatsTick$(of(payload), store).pipe(toArray()));

      expect(actions).toEqual([
        containerStatsReceived({
          entry: {
            stats: mockStats,
            status: { running: true },
            timestamp: '2024-01-01T00:00:00.000Z',
            receivedAt: expect.any(Number),
            clientId: 'client-1',
            agentId: 'agent-1',
          },
        }),
      ]);
    });

    it('should use selected client/agent ids from the store', async () => {
      store.overrideSelector(selectSelectedClientId, 'client-2');
      store.overrideSelector(selectSelectedAgentId, 'agent-2');
      store.refreshState();

      const actions = await firstValueFrom(
        mapContainerStatsTick$(of(createContainerStatsPayload()), store).pipe(toArray()),
      );

      expect(actions[0]).toEqual(
        containerStatsReceived({
          entry: expect.objectContaining({
            clientId: 'client-2',
            agentId: 'agent-2',
          }),
        }),
      );
    });

    it('should emit nothing for invalid payloads', async () => {
      const payload = {
        success: false as const,
        error: { message: 'Error' },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const actions = await firstValueFrom(mapContainerStatsTick$(of(payload), store).pipe(toArray()));

      expect(actions).toEqual([]);
    });

    it('should emit nothing for redundant stopped heartbeats', async () => {
      const stopped = createContainerStatsPayload({ status: { running: false } });
      const previous = buildContainerStatsEntry(stopped.data, 'client-1', 'agent-1', 1);

      store.overrideSelector(selectStatsByContainer, { 'client-1:agent-1': [previous] });
      store.refreshState();

      const actions = await firstValueFrom(mapContainerStatsTick$(of(stopped), store).pipe(toArray()));

      expect(actions).toEqual([]);
    });
  });
});
