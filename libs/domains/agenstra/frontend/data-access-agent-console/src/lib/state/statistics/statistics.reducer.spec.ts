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
  loadStatisticsChatIoSuccess,
  loadStatisticsEntityEvents,
  loadStatisticsEntityEventsSuccess,
  loadStatisticsFilterDrops,
  loadStatisticsFilterDropsSuccess,
  loadStatisticsSummary,
  loadStatisticsSummaryFailure,
  loadStatisticsSummarySuccess,
} from './statistics.actions';
import { initialStatisticsState, statisticsReducer, type StatisticsState } from './statistics.reducer';
import type {
  StatisticsChatIoListDto,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsSummaryDto,
} from './statistics.types';

describe('statisticsReducer', () => {
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

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = statisticsReducer(undefined, action as any);

      expect(state).toEqual(initialStatisticsState);
    });
  });

  describe('loadClientStatisticsSummary', () => {
    it('should set loadingClientSummary to true for clientId', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadClientStatisticsSummary({ clientId: 'client-1' }));

      expect(newState.loadingClientSummary['client-1']).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadClientStatisticsSummarySuccess', () => {
    it('should set clientSummary and set loading to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientSummary: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsSummarySuccess({ clientId: 'client-1', summary: mockSummary }),
      );

      expect(newState.clientSummary['client-1']).toEqual(mockSummary);
      expect(newState.loadingClientSummary['client-1']).toBe(false);
    });
  });

  describe('loadClientStatisticsSummaryFailure', () => {
    it('should set loading to false and error', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientSummary: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsSummaryFailure({ clientId: 'client-1', error: 'Load failed' }),
      );

      expect(newState.loadingClientSummary['client-1']).toBe(false);
      expect(newState.error).toBe('Load failed');
    });
  });

  describe('loadClientStatisticsChatIo', () => {
    it('should set loadingClientChatIo to true for clientId', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadClientStatisticsChatIo({ params: { clientId: 'client-1' } }));

      expect(newState.loadingClientChatIo['client-1']).toBe(true);
    });
  });

  describe('loadClientStatisticsChatIoSuccess', () => {
    it('should set clientChatIo and set loading to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientChatIo: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsChatIoSuccess({ clientId: 'client-1', data: mockChatIoList }),
      );

      expect(newState.clientChatIo['client-1']).toEqual(mockChatIoList);
      expect(newState.loadingClientChatIo['client-1']).toBe(false);
    });
  });

  describe('loadClientStatisticsChatIoFailure', () => {
    it('should set loading to false and error', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientChatIo: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsChatIoFailure({ clientId: 'client-1', error: 'Load failed' }),
      );

      expect(newState.loadingClientChatIo['client-1']).toBe(false);
      expect(newState.error).toBe('Load failed');
    });
  });

  describe('loadClientStatisticsFilterDrops', () => {
    it('should set loadingClientFilterDrops to true for clientId', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadClientStatisticsFilterDrops({ params: { clientId: 'client-1' } }));

      expect(newState.loadingClientFilterDrops['client-1']).toBe(true);
    });
  });

  describe('loadClientStatisticsFilterDropsSuccess', () => {
    it('should set clientFilterDrops and set loading to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientFilterDrops: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsFilterDropsSuccess({ clientId: 'client-1', data: mockFilterDropList }),
      );

      expect(newState.clientFilterDrops['client-1']).toEqual(mockFilterDropList);
      expect(newState.loadingClientFilterDrops['client-1']).toBe(false);
    });
  });

  describe('loadClientStatisticsFilterDropsFailure', () => {
    it('should set loading to false and error', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientFilterDrops: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsFilterDropsFailure({ clientId: 'client-1', error: 'Load failed' }),
      );

      expect(newState.loadingClientFilterDrops['client-1']).toBe(false);
      expect(newState.error).toBe('Load failed');
    });
  });

  describe('loadClientStatisticsEntityEvents', () => {
    it('should set loadingClientEntityEvents to true for clientId', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadClientStatisticsEntityEvents({ params: { clientId: 'client-1' } }));

      expect(newState.loadingClientEntityEvents['client-1']).toBe(true);
    });
  });

  describe('loadClientStatisticsEntityEventsSuccess', () => {
    it('should set clientEntityEvents and set loading to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientEntityEvents: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsEntityEventsSuccess({ clientId: 'client-1', data: mockEntityEventList }),
      );

      expect(newState.clientEntityEvents['client-1']).toEqual(mockEntityEventList);
      expect(newState.loadingClientEntityEvents['client-1']).toBe(false);
    });
  });

  describe('loadClientStatisticsEntityEventsFailure', () => {
    it('should set loading to false and error', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingClientEntityEvents: { 'client-1': true },
      };
      const newState = statisticsReducer(
        state,
        loadClientStatisticsEntityEventsFailure({ clientId: 'client-1', error: 'Load failed' }),
      );

      expect(newState.loadingClientEntityEvents['client-1']).toBe(false);
      expect(newState.error).toBe('Load failed');
    });
  });

  describe('loadStatisticsSummary (aggregate)', () => {
    it('should set loadingSummary to true', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadStatisticsSummary({}));

      expect(newState.loadingSummary).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('loadStatisticsSummarySuccess', () => {
    it('should set summary and loadingSummary to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingSummary: true,
      };
      const newState = statisticsReducer(state, loadStatisticsSummarySuccess({ summary: mockSummary }));

      expect(newState.summary).toEqual(mockSummary);
      expect(newState.loadingSummary).toBe(false);
    });
  });

  describe('loadStatisticsSummaryFailure', () => {
    it('should set loadingSummary to false and error', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingSummary: true,
      };
      const newState = statisticsReducer(state, loadStatisticsSummaryFailure({ error: 'Load failed' }));

      expect(newState.loadingSummary).toBe(false);
      expect(newState.error).toBe('Load failed');
    });
  });

  describe('loadStatisticsChatIo (aggregate)', () => {
    it('should set loadingChatIo to true', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadStatisticsChatIo({}));

      expect(newState.loadingChatIo).toBe(true);
    });
  });

  describe('loadStatisticsChatIoSuccess', () => {
    it('should set chatIo and loadingChatIo to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingChatIo: true,
      };
      const newState = statisticsReducer(state, loadStatisticsChatIoSuccess({ data: mockChatIoList }));

      expect(newState.chatIo).toEqual(mockChatIoList);
      expect(newState.loadingChatIo).toBe(false);
    });
  });

  describe('loadStatisticsFilterDrops (aggregate)', () => {
    it('should set loadingFilterDrops to true', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadStatisticsFilterDrops({}));

      expect(newState.loadingFilterDrops).toBe(true);
    });
  });

  describe('loadStatisticsFilterDropsSuccess', () => {
    it('should set filterDrops and loadingFilterDrops to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingFilterDrops: true,
      };
      const newState = statisticsReducer(state, loadStatisticsFilterDropsSuccess({ data: mockFilterDropList }));

      expect(newState.filterDrops).toEqual(mockFilterDropList);
      expect(newState.loadingFilterDrops).toBe(false);
    });
  });

  describe('loadStatisticsEntityEvents (aggregate)', () => {
    it('should set loadingEntityEvents to true', () => {
      const state: StatisticsState = { ...initialStatisticsState };
      const newState = statisticsReducer(state, loadStatisticsEntityEvents({}));

      expect(newState.loadingEntityEvents).toBe(true);
    });
  });

  describe('loadStatisticsEntityEventsSuccess', () => {
    it('should set entityEvents and loadingEntityEvents to false', () => {
      const state: StatisticsState = {
        ...initialStatisticsState,
        loadingEntityEvents: true,
      };
      const newState = statisticsReducer(state, loadStatisticsEntityEventsSuccess({ data: mockEntityEventList }));

      expect(newState.entityEvents).toEqual(mockEntityEventList);
      expect(newState.loadingEntityEvents).toBe(false);
    });
  });
});
