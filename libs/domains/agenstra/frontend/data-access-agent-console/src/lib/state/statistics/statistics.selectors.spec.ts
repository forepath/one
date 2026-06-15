import { initialStatisticsState, type StatisticsState } from './statistics.reducer';
import {
  selectChatIo,
  selectClientChatIo,
  selectClientEntityEvents,
  selectClientFilterDrops,
  selectClientSummary,
  selectEntityEvents,
  selectFilterDrops,
  selectLoadingClientSummary,
  selectLoadingSummary,
  selectStatisticsError,
  selectStatisticsState,
  selectSummary,
} from './statistics.selectors';
import type {
  StatisticsChatIoListDto,
  StatisticsEntityEventListDto,
  StatisticsFilterDropListDto,
  StatisticsSummaryDto,
} from './statistics.types';

describe('Statistics Selectors', () => {
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
  const createState = (overrides?: Partial<StatisticsState>): StatisticsState => ({
    ...initialStatisticsState,
    ...overrides,
  });

  describe('selectStatisticsState', () => {
    it('should select the statistics feature state', () => {
      const state = createState();
      const rootState = { statistics: state };
      const result = selectStatisticsState(rootState as any);

      expect(result).toEqual(state);
    });
  });

  describe('selectClientSummary', () => {
    it('should return client summary for clientId', () => {
      const state = createState({ clientSummary: { 'client-1': mockSummary } });
      const rootState = { statistics: state };
      const selector = selectClientSummary('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual(mockSummary);
    });

    it('should return undefined when no summary for clientId', () => {
      const state = createState();
      const rootState = { statistics: state };
      const selector = selectClientSummary('client-1');
      const result = selector(rootState as any);

      expect(result).toBeUndefined();
    });
  });

  describe('selectClientChatIo', () => {
    it('should return client chat I/O for clientId', () => {
      const state = createState({ clientChatIo: { 'client-1': mockChatIoList } });
      const rootState = { statistics: state };
      const selector = selectClientChatIo('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual(mockChatIoList);
    });
  });

  describe('selectClientFilterDrops', () => {
    it('should return client filter drops for clientId', () => {
      const state = createState({ clientFilterDrops: { 'client-1': mockFilterDropList } });
      const rootState = { statistics: state };
      const selector = selectClientFilterDrops('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual(mockFilterDropList);
    });
  });

  describe('selectClientEntityEvents', () => {
    it('should return client entity events for clientId', () => {
      const state = createState({ clientEntityEvents: { 'client-1': mockEntityEventList } });
      const rootState = { statistics: state };
      const selector = selectClientEntityEvents('client-1');
      const result = selector(rootState as any);

      expect(result).toEqual(mockEntityEventList);
    });
  });

  describe('selectLoadingClientSummary', () => {
    it('should return true when loading', () => {
      const state = createState({ loadingClientSummary: { 'client-1': true } });
      const rootState = { statistics: state };
      const selector = selectLoadingClientSummary('client-1');
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when not loading', () => {
      const state = createState();
      const rootState = { statistics: state };
      const selector = selectLoadingClientSummary('client-1');
      const result = selector(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('selectSummary (aggregate)', () => {
    it('should select aggregate summary', () => {
      const state = createState({ summary: mockSummary });
      const rootState = { statistics: state };
      const result = selectSummary(rootState as any);

      expect(result).toEqual(mockSummary);
    });

    it('should return null when no summary', () => {
      const state = createState({ summary: null });
      const rootState = { statistics: state };
      const result = selectSummary(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectChatIo (aggregate)', () => {
    it('should select aggregate chat I/O', () => {
      const state = createState({ chatIo: mockChatIoList });
      const rootState = { statistics: state };
      const result = selectChatIo(rootState as any);

      expect(result).toEqual(mockChatIoList);
    });
  });

  describe('selectFilterDrops (aggregate)', () => {
    it('should select aggregate filter drops', () => {
      const state = createState({ filterDrops: mockFilterDropList });
      const rootState = { statistics: state };
      const result = selectFilterDrops(rootState as any);

      expect(result).toEqual(mockFilterDropList);
    });
  });

  describe('selectEntityEvents (aggregate)', () => {
    it('should select aggregate entity events', () => {
      const state = createState({ entityEvents: mockEntityEventList });
      const rootState = { statistics: state };
      const result = selectEntityEvents(rootState as any);

      expect(result).toEqual(mockEntityEventList);
    });
  });

  describe('selectLoadingSummary', () => {
    it('should select loadingSummary', () => {
      const state = createState({ loadingSummary: true });
      const rootState = { statistics: state };
      const result = selectLoadingSummary(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectStatisticsError', () => {
    it('should select error', () => {
      const state = createState({ error: 'Test error' });
      const rootState = { statistics: state };
      const result = selectStatisticsError(rootState as any);

      expect(result).toBe('Test error');
    });

    it('should return null when no error', () => {
      const state = createState({ error: null });
      const rootState = { statistics: state };
      const result = selectStatisticsError(rootState as any);

      expect(result).toBeNull();
    });
  });
});
