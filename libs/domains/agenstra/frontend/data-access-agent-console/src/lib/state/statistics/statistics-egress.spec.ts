import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of, throwError } from 'rxjs';

import { StatisticsService } from '../../services/statistics.service';

import {
  loadClientStatisticsEgressEvents,
  loadClientStatisticsEgressEventsFailure,
  loadClientStatisticsEgressEventsSuccess,
  loadStatisticsEgressEvents,
  loadStatisticsEgressEventsFailure,
  loadStatisticsEgressEventsSuccess,
} from './statistics.actions';
import { loadClientStatisticsEgressEvents$, loadStatisticsEgressEvents$ } from './statistics.effects';
import { StatisticsFacade } from './statistics.facade';
import { initialStatisticsState, statisticsReducer } from './statistics.reducer';
import {
  selectClientEgressEvents,
  selectEgressEvents,
  selectLoadingClientEgressEvents,
  selectLoadingEgressEvents,
} from './statistics.selectors';
import type { StatisticsEgressEventListDto } from './statistics.types';

const list: StatisticsEgressEventListDto = {
  data: [
    {
      id: 'e1',
      clientId: 'client-1',
      agentId: 'agent-1',
      kind: 'web',
      decision: 'blocked',
      host: 'example.org',
      rule: 'deny_host',
      count: 2,
      bytesIn: 0,
      bytesOut: 10,
      firstSeenAt: '2026-10-12T10:00:00.000Z',
      occurredAt: '2026-10-12T10:00:05.000Z',
    },
  ],
  total: 1,
  limit: 10,
  offset: 0,
};

describe('Statistics egress events state', () => {
  describe('reducer', () => {
    it('tracks aggregate loading, data and errors', () => {
      let state = statisticsReducer(initialStatisticsState, loadStatisticsEgressEvents({ params: {} }));

      expect(state.loadingEgressEvents).toBe(true);

      state = statisticsReducer(state, loadStatisticsEgressEventsSuccess({ data: list }));
      expect(state.egressEvents).toEqual(list);
      expect(state.loadingEgressEvents).toBe(false);

      state = statisticsReducer(state, loadStatisticsEgressEventsFailure({ error: 'boom' }));
      expect(state.loadingEgressEvents).toBe(false);
      expect(state.error).toBe('boom');
      expect(state.egressEvents).toEqual(list);
    });

    it('tracks client-scoped egress events per client', () => {
      let state = statisticsReducer(
        initialStatisticsState,
        loadClientStatisticsEgressEvents({ params: { clientId: 'client-1' } }),
      );

      expect(state.loadingClientEgressEvents['client-1']).toBe(true);

      state = statisticsReducer(state, loadClientStatisticsEgressEventsSuccess({ clientId: 'client-1', data: list }));
      expect(state.clientEgressEvents['client-1']).toEqual(list);
      expect(state.loadingClientEgressEvents['client-1']).toBe(false);

      state = statisticsReducer(state, loadClientStatisticsEgressEventsFailure({ clientId: 'client-1', error: 'x' }));
      expect(state.loadingClientEgressEvents['client-1']).toBe(false);
      expect(state.error).toBe('x');
    });
  });

  describe('selectors', () => {
    it('select aggregate and client egress state', () => {
      const state = {
        statistics: {
          ...initialStatisticsState,
          egressEvents: list,
          loadingEgressEvents: true,
          clientEgressEvents: { 'client-1': list },
          loadingClientEgressEvents: { 'client-1': true },
        },
      };

      expect(selectEgressEvents(state)).toEqual(list);
      expect(selectLoadingEgressEvents(state)).toBe(true);
      expect(selectClientEgressEvents('client-1')(state)).toEqual(list);
      expect(selectLoadingClientEgressEvents('client-1')(state)).toBe(true);
      expect(selectLoadingClientEgressEvents('other')(state)).toBe(false);
    });
  });

  describe('effects', () => {
    let actions$: Actions;
    let statisticsService: { getEgressEvents: jest.Mock; getClientEgressEvents: jest.Mock };

    beforeEach(() => {
      statisticsService = { getEgressEvents: jest.fn(), getClientEgressEvents: jest.fn() };
    });

    function setup(action: unknown) {
      TestBed.configureTestingModule({
        providers: [provideMockActions(() => of(action)), { provide: StatisticsService, useValue: statisticsService }],
      });
      actions$ = TestBed.inject(Actions);
    }

    it('loads aggregate egress events', async () => {
      statisticsService.getEgressEvents.mockReturnValue(of(list));
      setup(loadStatisticsEgressEvents({ params: { decision: 'blocked' } }));

      const result = await firstValueFrom(
        TestBed.runInInjectionContext(() => loadStatisticsEgressEvents$(actions$, statisticsService as never)),
      );

      expect(statisticsService.getEgressEvents).toHaveBeenCalledWith({ decision: 'blocked' });
      expect(result).toEqual(loadStatisticsEgressEventsSuccess({ data: list }));
    });

    it('maps aggregate failures', async () => {
      statisticsService.getEgressEvents.mockReturnValue(throwError(() => new Error('network')));
      setup(loadStatisticsEgressEvents({ params: {} }));

      const result = await firstValueFrom(
        TestBed.runInInjectionContext(() => loadStatisticsEgressEvents$(actions$, statisticsService as never)),
      );

      expect(result).toEqual(loadStatisticsEgressEventsFailure({ error: 'network' }));
    });

    it('loads and fails client-scoped egress events', async () => {
      statisticsService.getClientEgressEvents.mockReturnValue(of(list));
      setup(loadClientStatisticsEgressEvents({ params: { clientId: 'client-1', kind: 'dns' } }));

      await expect(
        firstValueFrom(
          TestBed.runInInjectionContext(() => loadClientStatisticsEgressEvents$(actions$, statisticsService as never)),
        ),
      ).resolves.toEqual(loadClientStatisticsEgressEventsSuccess({ clientId: 'client-1', data: list }));
      expect(statisticsService.getClientEgressEvents).toHaveBeenCalledWith('client-1', {
        clientId: 'client-1',
        kind: 'dns',
      });

      TestBed.resetTestingModule();
      statisticsService.getClientEgressEvents.mockReturnValue(throwError(() => 'denied'));
      setup(loadClientStatisticsEgressEvents({ params: { clientId: 'client-1' } }));

      await expect(
        firstValueFrom(
          TestBed.runInInjectionContext(() => loadClientStatisticsEgressEvents$(actions$, statisticsService as never)),
        ),
      ).resolves.toEqual(loadClientStatisticsEgressEventsFailure({ clientId: 'client-1', error: 'denied' }));
    });
  });

  describe('facade', () => {
    it('dispatches egress actions and exposes selectors', () => {
      const store = { dispatch: jest.fn(), select: jest.fn().mockReturnValue(of(list)) };

      TestBed.configureTestingModule({ providers: [StatisticsFacade, { provide: Store, useValue: store }] });

      const facade = TestBed.inject(StatisticsFacade);

      facade.loadEgressEvents({ decision: 'observed' });
      facade.loadClientEgressEvents({ clientId: 'client-1' });
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsEgressEvents({ params: { decision: 'observed' } }));
      expect(store.dispatch).toHaveBeenCalledWith(
        loadClientStatisticsEgressEvents({ params: { clientId: 'client-1' } }),
      );

      facade.getClientEgressEvents$('client-1');
      facade.getLoadingClientEgressEvents$('client-1');
      expect(store.select).toHaveBeenCalled();
    });
  });
});
