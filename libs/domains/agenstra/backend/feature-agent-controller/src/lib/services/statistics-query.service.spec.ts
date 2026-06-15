import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { StatisticsEntityEventType, StatisticsEntityType } from '../entities/statistics-entity-event.entity';
import { StatisticsRepository } from '../repositories/statistics.repository';

import { StatisticsQueryService } from './statistics-query.service';

describe('StatisticsQueryService', () => {
  let service: StatisticsQueryService;
  let repository: jest.Mocked<StatisticsRepository>;
  const mockRepository = {
    findStatisticsClientIdsByOriginalIds: jest.fn(),
    queryChatIo: jest.fn(),
    queryChatIoAggregate: jest.fn(),
    queryFilterDrops: jest.fn(),
    queryFilterDropsAggregate: jest.fn(),
    queryFilterFlags: jest.fn(),
    queryFilterFlagsAggregate: jest.fn(),
    queryEntityEvents: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatisticsQueryService, { provide: StatisticsRepository, useValue: mockRepository }],
    }).compile();

    service = module.get<StatisticsQueryService>(StatisticsQueryService);
    repository = module.get(StatisticsRepository);
    jest.clearAllMocks();
  });

  describe('getClientSummary', () => {
    it('should map clientId to statistics IDs and return summary', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryChatIoAggregate.mockResolvedValue({
        totalMessages: 5,
        totalWords: 50,
        totalChars: 250,
        avgWordsPerMessage: 10,
      });
      mockRepository.queryFilterDropsAggregate.mockResolvedValue({
        filterDropCount: 2,
        filterTypesBreakdown: [],
        uniqueFilterTypes: [],
      });
      mockRepository.queryFilterFlagsAggregate.mockResolvedValue({
        filterFlagCount: 1,
        filterTypesBreakdown: [],
      });

      const result = await service.getClientSummary('client-1', {});

      expect(repository.findStatisticsClientIdsByOriginalIds).toHaveBeenCalledWith(['client-1']);
      expect(result.totalMessages).toBe(5);
      expect(result.filterDropCount).toBe(2);
    });

    it('should return zeros when no statistics client found', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue([]);

      const result = await service.getClientSummary('client-unknown', {});

      expect(result.totalMessages).toBe(0);
      expect(result.filterDropCount).toBe(0);
    });

    it('should throw BadRequestException for invalid from date', async () => {
      await expect(service.getClientSummary('client-1', { from: 'invalid-date' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('getClientChatIo', () => {
    it('should return paginated chat I/O', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryChatIo.mockResolvedValue({
        rows: [],
        total: 0,
      });

      const result = await service.getClientChatIo('client-1', { limit: 20, offset: 0 });

      expect(repository.queryChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          limit: 20,
          offset: 0,
        }),
      );
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should pass search param to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryChatIo.mockResolvedValue({ rows: [], total: 0 });

      await service.getClientChatIo('client-1', { search: 'input', limit: 10, offset: 0 });

      expect(repository.queryChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          search: 'input',
          limit: 10,
          offset: 0,
        }),
      );
    });
  });

  describe('getChatIo', () => {
    it('should pass accessible client IDs to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1', 'sc2']);
      mockRepository.queryChatIo.mockResolvedValue({ rows: [], total: 0 });

      await service.getChatIo(['c1', 'c2'], { limit: 10, offset: 0 });

      expect(repository.findStatisticsClientIdsByOriginalIds).toHaveBeenCalledWith(['c1', 'c2']);
      expect(repository.queryChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1', 'sc2'],
        }),
      );
    });

    it('should pass search param to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryChatIo.mockResolvedValue({ rows: [], total: 0 });

      await service.getChatIo(['c1'], { search: 'output', limit: 10, offset: 0 });

      expect(repository.queryChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          search: 'output',
          limit: 10,
          offset: 0,
        }),
      );
    });
  });

  describe('getClientFilterDrops', () => {
    it('should return filter drops for client', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryFilterDrops.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.getClientFilterDrops('client-1', {
        filterType: 'profanity',
        limit: 10,
        offset: 0,
      });

      expect(repository.queryFilterDrops).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          filterType: 'profanity',
        }),
      );
      expect(result.data).toEqual([]);
    });

    it('should pass search param to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryFilterDrops.mockResolvedValue({ rows: [], total: 0 });

      await service.getClientFilterDrops('client-1', {
        search: 'profanity',
        limit: 10,
        offset: 0,
      });

      expect(repository.queryFilterDrops).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          search: 'profanity',
        }),
      );
    });
  });

  describe('getFilterDrops', () => {
    it('should pass search param to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryFilterDrops.mockResolvedValue({ rows: [], total: 0 });

      await service.getFilterDrops(['c1'], { search: 'spam', limit: 10, offset: 0 });

      expect(repository.queryFilterDrops).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          search: 'spam',
        }),
      );
    });
  });

  describe('getClientEntityEvents', () => {
    it('should return entity events for client', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryEntityEvents.mockResolvedValue({ rows: [], total: 0 });

      const result = await service.getClientEntityEvents('client-1', {
        entityType: StatisticsEntityType.AGENT,
        eventType: StatisticsEntityEventType.CREATED,
        limit: 10,
        offset: 0,
      });

      expect(repository.queryEntityEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          entityType: StatisticsEntityType.AGENT,
          eventType: StatisticsEntityEventType.CREATED,
        }),
      );
      expect(result.data).toEqual([]);
    });

    it('should pass search param to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryEntityEvents.mockResolvedValue({ rows: [], total: 0 });

      await service.getClientEntityEvents('client-1', {
        search: 'agent',
        limit: 10,
        offset: 0,
      });

      expect(repository.queryEntityEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          search: 'agent',
        }),
      );
    });
  });

  describe('getClientChatIo interactionKind filter', () => {
    it('accepts autonomous_ticket_run_turn', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryChatIo.mockResolvedValue({ rows: [], total: 0 });

      await service.getClientChatIo('client-1', {
        limit: 10,
        offset: 0,
        interactionKind: StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN_TURN,
      });

      expect(repository.queryChatIo).toHaveBeenCalledWith(
        expect.objectContaining({
          interactionKind: StatisticsInteractionKind.AUTONOMOUS_TICKET_RUN_TURN,
        }),
      );
    });
  });

  describe('getEntityEvents', () => {
    it('should pass accessible client IDs to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryEntityEvents.mockResolvedValue({ rows: [], total: 0 });

      await service.getEntityEvents(['c1'], { limit: 10, offset: 0 });

      expect(repository.findStatisticsClientIdsByOriginalIds).toHaveBeenCalledWith(['c1']);
      expect(repository.queryEntityEvents).toHaveBeenCalled();
    });

    it('should pass search param to repository', async () => {
      mockRepository.findStatisticsClientIdsByOriginalIds.mockResolvedValue(['sc1']);
      mockRepository.queryEntityEvents.mockResolvedValue({ rows: [], total: 0 });

      await service.getEntityEvents(['c1'], { search: 'created', limit: 10, offset: 0 });

      expect(repository.queryEntityEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          statisticsClientIds: ['sc1'],
          search: 'created',
        }),
      );
    });
  });
});
