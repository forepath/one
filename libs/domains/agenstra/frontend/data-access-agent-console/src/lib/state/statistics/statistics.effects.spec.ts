import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { StatisticsService } from '../../services/statistics.service';

import {
  loadClientStatisticsChatIo,
  loadClientStatisticsChatIoFailure,
  loadClientStatisticsChatIoSuccess,
  loadClientStatisticsEntityEvents,
  loadClientStatisticsEntityEventsFailure,
  loadClientStatisticsEntityEventsSuccess,
  loadClientStatisticsFilterDrops,
  loadClientStatisticsFilterDropsFailure,
  loadClientStatisticsFilterDropsSuccess,
  loadClientStatisticsSummary,
  loadClientStatisticsSummaryFailure,
  loadClientStatisticsSummarySuccess,
  loadStatisticsChatIo,
  loadStatisticsChatIoFailure,
  loadStatisticsChatIoSuccess,
  loadStatisticsEntityEvents,
  loadStatisticsEntityEventsFailure,
  loadStatisticsEntityEventsSuccess,
  loadStatisticsFilterDrops,
  loadStatisticsFilterDropsFailure,
  loadStatisticsFilterDropsSuccess,
  loadStatisticsSummary,
  loadStatisticsSummaryFailure,
  loadStatisticsSummarySuccess,
} from './statistics.actions';
import {
  loadClientStatisticsChatIo$,
  loadClientStatisticsEntityEvents$,
  loadClientStatisticsFilterDrops$,
  loadClientStatisticsSummary$,
  loadStatisticsChatIo$,
  loadStatisticsEntityEvents$,
  loadStatisticsFilterDrops$,
  loadStatisticsSummary$,
} from './statistics.effects';
import type {
  StatisticsChatIoListDto,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsSummaryDto,
} from './statistics.types';

describe('StatisticsEffects', () => {
  let actions$: Actions;
  let statisticsService: jest.Mocked<StatisticsService>;
  const mockSummary: StatisticsSummaryDto = {
    totalMessages: 100,
    totalWords: 500,
    totalChars: 2500,
    avgWordsPerMessage: 5,
    filterDropCount: 2,
    filterTypesBreakdown: [],
    filterFlagCount: 0,
    filterFlagsBreakdown: [],
  };
  const mockChatIoList: StatisticsChatIoListDto = {
    data: [],
    total: 0,
    limit: 10,
    offset: 0,
  };
  const mockFilterDropList: StatisticsFilterDropListDto = {
    data: [],
    total: 0,
    limit: 10,
    offset: 0,
  };
  const mockEntityEventList: StatisticsEntityEventListDto = {
    data: [],
    total: 0,
    limit: 10,
    offset: 0,
  };

  beforeEach(() => {
    statisticsService = {
      getClientSummary: jest.fn(),
      getClientChatIo: jest.fn(),
      getClientFilterDrops: jest.fn(),
      getClientEntityEvents: jest.fn(),
      getSummary: jest.fn(),
      getChatIo: jest.fn(),
      getFilterDrops: jest.fn(),
      getEntityEvents: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: StatisticsService,
          useValue: statisticsService,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadClientStatisticsSummary$', () => {
    it('should return loadClientStatisticsSummarySuccess on success', (done) => {
      const action = loadClientStatisticsSummary({ clientId: 'client-1' });
      const outcome = loadClientStatisticsSummarySuccess({ clientId: 'client-1', summary: mockSummary });

      actions$ = of(action);
      statisticsService.getClientSummary.mockReturnValue(of(mockSummary));

      loadClientStatisticsSummary$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(statisticsService.getClientSummary).toHaveBeenCalledWith('client-1', undefined);
        done();
      });
    });

    it('should return loadClientStatisticsSummaryFailure on error', (done) => {
      const action = loadClientStatisticsSummary({ clientId: 'client-1' });
      const error = new Error('Load failed');
      const outcome = loadClientStatisticsSummaryFailure({ clientId: 'client-1', error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getClientSummary.mockReturnValue(throwError(() => error));

      loadClientStatisticsSummary$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientStatisticsChatIo$', () => {
    it('should return loadClientStatisticsChatIoSuccess on success', (done) => {
      const params = { clientId: 'client-1', limit: 10, offset: 0 };
      const action = loadClientStatisticsChatIo({ params });
      const outcome = loadClientStatisticsChatIoSuccess({ clientId: 'client-1', data: mockChatIoList });

      actions$ = of(action);
      statisticsService.getClientChatIo.mockReturnValue(of(mockChatIoList));

      loadClientStatisticsChatIo$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(statisticsService.getClientChatIo).toHaveBeenCalledWith('client-1', params);
        done();
      });
    });

    it('should return loadClientStatisticsChatIoFailure on error', (done) => {
      const params = { clientId: 'client-1' };
      const action = loadClientStatisticsChatIo({ params });
      const outcome = loadClientStatisticsChatIoFailure({ clientId: 'client-1', error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getClientChatIo.mockReturnValue(throwError(() => new Error('Load failed')));

      loadClientStatisticsChatIo$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientStatisticsFilterDrops$', () => {
    it('should return loadClientStatisticsFilterDropsSuccess on success', (done) => {
      const params = { clientId: 'client-1' };
      const action = loadClientStatisticsFilterDrops({ params });
      const outcome = loadClientStatisticsFilterDropsSuccess({ clientId: 'client-1', data: mockFilterDropList });

      actions$ = of(action);
      statisticsService.getClientFilterDrops.mockReturnValue(of(mockFilterDropList));

      loadClientStatisticsFilterDrops$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(statisticsService.getClientFilterDrops).toHaveBeenCalledWith('client-1', params);
        done();
      });
    });

    it('should return loadClientStatisticsFilterDropsFailure on error', (done) => {
      const params = { clientId: 'client-1' };
      const action = loadClientStatisticsFilterDrops({ params });
      const outcome = loadClientStatisticsFilterDropsFailure({ clientId: 'client-1', error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getClientFilterDrops.mockReturnValue(throwError(() => new Error('Load failed')));

      loadClientStatisticsFilterDrops$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientStatisticsEntityEvents$', () => {
    it('should return loadClientStatisticsEntityEventsSuccess on success', (done) => {
      const params = { clientId: 'client-1' };
      const action = loadClientStatisticsEntityEvents({ params });
      const outcome = loadClientStatisticsEntityEventsSuccess({ clientId: 'client-1', data: mockEntityEventList });

      actions$ = of(action);
      statisticsService.getClientEntityEvents.mockReturnValue(of(mockEntityEventList));

      loadClientStatisticsEntityEvents$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(statisticsService.getClientEntityEvents).toHaveBeenCalledWith('client-1', params);
        done();
      });
    });

    it('should return loadClientStatisticsEntityEventsFailure on error', (done) => {
      const params = { clientId: 'client-1' };
      const action = loadClientStatisticsEntityEvents({ params });
      const outcome = loadClientStatisticsEntityEventsFailure({ clientId: 'client-1', error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getClientEntityEvents.mockReturnValue(throwError(() => new Error('Load failed')));

      loadClientStatisticsEntityEvents$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadStatisticsSummary$', () => {
    it('should return loadStatisticsSummarySuccess on success', (done) => {
      const action = loadStatisticsSummary({});
      const outcome = loadStatisticsSummarySuccess({ summary: mockSummary });

      actions$ = of(action);
      statisticsService.getSummary.mockReturnValue(of(mockSummary));

      loadStatisticsSummary$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(statisticsService.getSummary).toHaveBeenCalledWith(undefined);
        done();
      });
    });

    it('should return loadStatisticsSummaryFailure on error', (done) => {
      const action = loadStatisticsSummary({});
      const outcome = loadStatisticsSummaryFailure({ error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getSummary.mockReturnValue(throwError(() => new Error('Load failed')));

      loadStatisticsSummary$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadStatisticsChatIo$', () => {
    it('should return loadStatisticsChatIoSuccess on success', (done) => {
      const action = loadStatisticsChatIo({});
      const outcome = loadStatisticsChatIoSuccess({ data: mockChatIoList });

      actions$ = of(action);
      statisticsService.getChatIo.mockReturnValue(of(mockChatIoList));

      loadStatisticsChatIo$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should pass search param to getChatIo when provided', (done) => {
      const params = { search: 'input', limit: 10, offset: 0 };
      const action = loadStatisticsChatIo({ params });
      const outcome = loadStatisticsChatIoSuccess({ data: mockChatIoList });

      actions$ = of(action);
      statisticsService.getChatIo.mockReturnValue(of(mockChatIoList));

      loadStatisticsChatIo$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(statisticsService.getChatIo).toHaveBeenCalledWith(params);
        done();
      });
    });

    it('should return loadStatisticsChatIoFailure on error', (done) => {
      const action = loadStatisticsChatIo({});
      const outcome = loadStatisticsChatIoFailure({ error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getChatIo.mockReturnValue(throwError(() => new Error('Load failed')));

      loadStatisticsChatIo$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadStatisticsFilterDrops$', () => {
    it('should return loadStatisticsFilterDropsSuccess on success', (done) => {
      const action = loadStatisticsFilterDrops({});
      const outcome = loadStatisticsFilterDropsSuccess({ data: mockFilterDropList });

      actions$ = of(action);
      statisticsService.getFilterDrops.mockReturnValue(of(mockFilterDropList));

      loadStatisticsFilterDrops$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadStatisticsFilterDropsFailure on error', (done) => {
      const action = loadStatisticsFilterDrops({});
      const outcome = loadStatisticsFilterDropsFailure({ error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getFilterDrops.mockReturnValue(throwError(() => new Error('Load failed')));

      loadStatisticsFilterDrops$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadStatisticsEntityEvents$', () => {
    it('should return loadStatisticsEntityEventsSuccess on success', (done) => {
      const action = loadStatisticsEntityEvents({});
      const outcome = loadStatisticsEntityEventsSuccess({ data: mockEntityEventList });

      actions$ = of(action);
      statisticsService.getEntityEvents.mockReturnValue(of(mockEntityEventList));

      loadStatisticsEntityEvents$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadStatisticsEntityEventsFailure on error', (done) => {
      const action = loadStatisticsEntityEvents({});
      const outcome = loadStatisticsEntityEventsFailure({ error: 'Load failed' });

      actions$ = of(action);
      statisticsService.getEntityEvents.mockReturnValue(throwError(() => new Error('Load failed')));

      loadStatisticsEntityEvents$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('error normalization', () => {
    it('should normalize Error objects', (done) => {
      const action = loadStatisticsSummary({});
      const outcome = loadStatisticsSummaryFailure({ error: 'Test error' });

      actions$ = of(action);
      statisticsService.getSummary.mockReturnValue(throwError(() => new Error('Test error')));

      loadStatisticsSummary$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should use default error message for unknown error types', (done) => {
      const action = loadStatisticsSummary({});
      const outcome = loadStatisticsSummaryFailure({ error: 'An unexpected error occurred' });

      actions$ = of(action);
      statisticsService.getSummary.mockReturnValue(throwError(() => ({ unknown: 'property' })));

      loadStatisticsSummary$(actions$, statisticsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });
});
