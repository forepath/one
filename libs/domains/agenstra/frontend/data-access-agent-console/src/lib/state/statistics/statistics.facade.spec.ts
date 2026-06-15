import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  loadClientStatisticsChatIo,
  loadClientStatisticsEntityEvents,
  loadClientStatisticsFilterDrops,
  loadClientStatisticsSummary,
  loadStatisticsChatIo,
  loadStatisticsEntityEvents,
  loadStatisticsFilterDrops,
  loadStatisticsSummary,
} from './statistics.actions';
import { StatisticsFacade } from './statistics.facade';
import type {
  StatisticsAggregateParams,
  StatisticsChatIoListDto,
  StatisticsClientScopeParams,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsSummaryDto,
} from './statistics.types';

describe('StatisticsFacade', () => {
  let facade: StatisticsFacade;
  let store: jest.Mocked<Store>;
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
  const createFacadeWithMock = (mockSelectReturn: unknown): StatisticsFacade => {
    const mockStore = {
      select: jest.fn().mockReturnValue(of(mockSelectReturn)),
      dispatch: jest.fn(),
    } as any;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        StatisticsFacade,
        {
          provide: Store,
          useValue: mockStore,
        },
      ],
    });

    return TestBed.inject(StatisticsFacade);
  };

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        StatisticsFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(StatisticsFacade);
  });

  describe('Aggregate State Observables', () => {
    it('should expose summary$ observable', (done) => {
      const testFacade = createFacadeWithMock(mockSummary);

      testFacade.summary$.subscribe((result) => {
        expect(result).toEqual(mockSummary);
        done();
      });
    });

    it('should expose chatIo$ observable', (done) => {
      const testFacade = createFacadeWithMock(mockChatIoList);

      testFacade.chatIo$.subscribe((result) => {
        expect(result).toEqual(mockChatIoList);
        done();
      });
    });

    it('should expose filterDrops$ observable', (done) => {
      const testFacade = createFacadeWithMock(mockFilterDropList);

      testFacade.filterDrops$.subscribe((result) => {
        expect(result).toEqual(mockFilterDropList);
        done();
      });
    });

    it('should expose entityEvents$ observable', (done) => {
      const testFacade = createFacadeWithMock(mockEntityEventList);

      testFacade.entityEvents$.subscribe((result) => {
        expect(result).toEqual(mockEntityEventList);
        done();
      });
    });

    it('should expose error$ observable', (done) => {
      const error = 'Test error';
      const testFacade = createFacadeWithMock(error);

      testFacade.error$.subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });
  });

  describe('Client-Scoped Load Methods', () => {
    it('should dispatch loadClientStatisticsSummary', () => {
      facade.loadClientSummary('client-1');
      expect(store.dispatch).toHaveBeenCalledWith(
        loadClientStatisticsSummary({ clientId: 'client-1', params: undefined }),
      );
    });

    it('should dispatch loadClientStatisticsSummary with params', () => {
      const params = { from: '2024-01-01', to: '2024-01-31', groupBy: 'day' as const };

      facade.loadClientSummary('client-1', params);
      expect(store.dispatch).toHaveBeenCalledWith(loadClientStatisticsSummary({ clientId: 'client-1', params }));
    });

    it('should dispatch loadClientStatisticsChatIo', () => {
      const params: StatisticsClientScopeParams = { clientId: 'client-1', limit: 10, offset: 0 };

      facade.loadClientChatIo(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadClientStatisticsChatIo({ params }));
    });

    it('should dispatch loadClientStatisticsChatIo with search param', () => {
      const params: StatisticsClientScopeParams = { clientId: 'client-1', search: 'input', limit: 10, offset: 0 };

      facade.loadClientChatIo(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadClientStatisticsChatIo({ params }));
    });

    it('should dispatch loadClientStatisticsFilterDrops', () => {
      const params: StatisticsClientScopeParams = { clientId: 'client-1' };

      facade.loadClientFilterDrops(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadClientStatisticsFilterDrops({ params }));
    });

    it('should dispatch loadClientStatisticsEntityEvents', () => {
      const params: StatisticsClientScopeParams = { clientId: 'client-1' };

      facade.loadClientEntityEvents(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadClientStatisticsEntityEvents({ params }));
    });
  });

  describe('Aggregate Load Methods', () => {
    it('should dispatch loadStatisticsSummary', () => {
      facade.loadSummary();
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsSummary({ params: undefined }));
    });

    it('should dispatch loadStatisticsSummary with params', () => {
      const params: StatisticsAggregateParams = { clientId: 'client-1' };

      facade.loadSummary(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsSummary({ params }));
    });

    it('should dispatch loadStatisticsChatIo', () => {
      facade.loadChatIo();
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsChatIo({ params: undefined }));
    });

    it('should dispatch loadStatisticsChatIo with search param', () => {
      const params: StatisticsAggregateParams = { search: 'query', limit: 10, offset: 0 };

      facade.loadChatIo(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsChatIo({ params }));
    });

    it('should dispatch loadStatisticsFilterDrops', () => {
      facade.loadFilterDrops();
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsFilterDrops({ params: undefined }));
    });

    it('should dispatch loadStatisticsEntityEvents', () => {
      facade.loadEntityEvents();
      expect(store.dispatch).toHaveBeenCalledWith(loadStatisticsEntityEvents({ params: undefined }));
    });
  });

  describe('Client-Scoped Getters', () => {
    it('should return client summary observable', (done) => {
      const testFacade = createFacadeWithMock(mockSummary);

      testFacade.getClientSummary$('client-1').subscribe((result) => {
        expect(result).toEqual(mockSummary);
        done();
      });
    });

    it('should return client chat I/O observable', (done) => {
      const testFacade = createFacadeWithMock(mockChatIoList);

      testFacade.getClientChatIo$('client-1').subscribe((result) => {
        expect(result).toEqual(mockChatIoList);
        done();
      });
    });

    it('should return loading state observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.getLoadingClientSummary$('client-1').subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });
});
