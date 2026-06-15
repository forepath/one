import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';

import { forwardedEventReceived } from '../sockets/sockets.actions';
import { selectSelectedAgentId, selectSelectedClientId } from '../sockets/sockets.selectors';
import { ChatActor } from '../sockets/sockets.types';
import type { ChatMessageData, ContainerStatsPayload, SuccessResponse } from '../sockets/sockets.types';

import { containerStatsReceived } from './stats.actions';
import { processContainerStats$ } from './stats.effects';

describe('StatsEffects', () => {
  let actions$: Actions;
  let store: MockStore;
  let effects: ReturnType<typeof processContainerStats$>;
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
  const createContainerStatsPayload = (): SuccessResponse<ContainerStatsPayload> => ({
    success: true,
    data: {
      status: { running: true },
      stats: mockStats,
      timestamp: '2024-01-01T00:00:00.000Z',
    },
    timestamp: '2024-01-01T00:00:00.000Z',
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            {
              selector: selectSelectedClientId,
              value: 'client-1',
            },
            {
              selector: selectSelectedAgentId,
              value: 'agent-1',
            },
          ],
        }),
      ],
    });

    store = TestBed.inject(MockStore);
    const actions = TestBed.inject(Actions);

    effects = processContainerStats$(actions, store);
  });

  describe('processContainerStats$', () => {
    it('should dispatch containerStatsReceived when containerStats event is received', (done) => {
      const payload = createContainerStatsPayload();

      actions$ = of(forwardedEventReceived({ event: 'containerStats', payload }));

      effects.subscribe((action) => {
        expect(action).toEqual(
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
        );
        done();
      });
    });

    it('should use selectedClientId and selectedAgentId from store', (done) => {
      store.overrideSelector(selectSelectedClientId, 'client-2');
      store.overrideSelector(selectSelectedAgentId, 'agent-2');
      store.refreshState();

      const payload = createContainerStatsPayload();

      actions$ = of(forwardedEventReceived({ event: 'containerStats', payload }));

      effects.subscribe((action) => {
        expect(action).toEqual(
          containerStatsReceived({
            entry: expect.objectContaining({
              clientId: 'client-2',
              agentId: 'agent-2',
            }),
          }),
        );
        done();
      });
    });

    it('should use "unknown" as clientId and agentId when selected values are null', (done) => {
      store.overrideSelector(selectSelectedClientId, null);
      store.overrideSelector(selectSelectedAgentId, null);
      store.refreshState();

      const payload = createContainerStatsPayload();

      actions$ = of(forwardedEventReceived({ event: 'containerStats', payload }));

      effects.subscribe((action) => {
        expect(action).toEqual(
          containerStatsReceived({
            entry: expect.objectContaining({
              clientId: 'unknown',
              agentId: 'unknown',
            }),
          }),
        );
        done();
      });
    });

    it('should not process non-containerStats events', (done) => {
      const payload: SuccessResponse<ChatMessageData> = {
        success: true as const,
        data: {
          from: ChatActor.USER,
          text: 'test',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      actions$ = of(forwardedEventReceived({ event: 'chatMessage', payload }));

      let callCount = 0;
      const subscription = effects.subscribe(() => {
        callCount++;
      });

      // Complete the observable to ensure it processes
      setTimeout(() => {
        subscription.unsubscribe();
        expect(callCount).toBe(0);
        done();
      }, 10);
    });

    it('should not dispatch for invalid payload (not success)', (done) => {
      const payload = {
        success: false as const,
        error: {
          message: 'Error',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };

      actions$ = of(forwardedEventReceived({ event: 'containerStats', payload }));

      let callCount = 0;
      const subscription = effects.subscribe(() => {
        callCount++;
      });

      setTimeout(() => {
        subscription.unsubscribe();
        // Should not dispatch anything for invalid payloads
        expect(callCount).toBe(0);
        done();
      }, 10);
    });

    it('should not dispatch for payload without data', (done) => {
      // Create a payload that looks like SuccessResponse but without data property
      const payload = {
        success: true as const,
        timestamp: '2024-01-01T00:00:00.000Z',
      } as unknown as SuccessResponse<ContainerStatsPayload>;

      actions$ = of(forwardedEventReceived({ event: 'containerStats', payload }));

      let callCount = 0;
      const subscription = effects.subscribe(() => {
        callCount++;
      });

      setTimeout(() => {
        subscription.unsubscribe();
        // Should not dispatch anything for invalid payloads
        expect(callCount).toBe(0);
        done();
      }, 10);
    });
  });
});
