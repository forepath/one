import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsService } from '../services/clients.service';
import { StatisticsQueryService } from '../services/statistics-query.service';

import { StatisticsController } from './statistics.controller';

describe('StatisticsController', () => {
  let controller: StatisticsController;
  let clientsService: jest.Mocked<ClientsService>;
  let statisticsQueryService: jest.Mocked<StatisticsQueryService>;
  const mockClientsService = {
    getAccessibleClientIds: jest.fn(),
  };
  const mockStatisticsQueryService = {
    getSummary: jest.fn(),
    getChatIo: jest.fn(),
    getFilterDrops: jest.fn(),
    getEntityEvents: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StatisticsController],
      providers: [
        { provide: ClientsService, useValue: mockClientsService },
        { provide: StatisticsQueryService, useValue: mockStatisticsQueryService },
      ],
    }).compile();

    controller = module.get<StatisticsController>(StatisticsController);
    clientsService = module.get(ClientsService);
    statisticsQueryService = module.get(StatisticsQueryService);
    jest.clearAllMocks();
  });

  describe('getSummary', () => {
    it('should return aggregate summary when no clientId', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1', 'c2']);
      mockStatisticsQueryService.getSummary.mockResolvedValue({
        totalMessages: 5,
        totalWords: 50,
        totalChars: 250,
        avgWordsPerMessage: 10,
        filterDropCount: 0,
        filterTypesBreakdown: [],
      });

      const result = await controller.getSummary(undefined, undefined, undefined, undefined, {} as never);

      expect(clientsService.getAccessibleClientIds).toHaveBeenCalled();
      expect(statisticsQueryService.getSummary).toHaveBeenCalledWith(['c1', 'c2'], expect.any(Object));
      expect(result.totalMessages).toBe(5);
    });

    it('should filter by clientId when provided and user has access', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1', 'c2']);
      mockStatisticsQueryService.getSummary.mockResolvedValue({
        totalMessages: 2,
        totalWords: 20,
        totalChars: 100,
        avgWordsPerMessage: 10,
        filterDropCount: 0,
        filterTypesBreakdown: [],
      });

      const result = await controller.getSummary('c1', undefined, undefined, undefined, {} as never);

      expect(statisticsQueryService.getSummary).toHaveBeenCalledWith(['c1'], expect.any(Object));
      expect(result.totalMessages).toBe(2);
    });

    it('should throw 403 when clientId provided but not in accessible list', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1', 'c2']);

      await expect(controller.getSummary('c3', undefined, undefined, undefined, {} as never)).rejects.toThrow(
        ForbiddenException,
      );

      expect(statisticsQueryService.getSummary).not.toHaveBeenCalled();
    });
  });

  describe('getChatIo', () => {
    it('should call getAccessibleClientIds and getChatIo', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1']);
      mockStatisticsQueryService.getChatIo.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getChatIo(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      );

      expect(clientsService.getAccessibleClientIds).toHaveBeenCalled();
      expect(statisticsQueryService.getChatIo).toHaveBeenCalledWith(['c1'], expect.any(Object));
    });
  });

  describe('getFilterDrops', () => {
    it('should call getAccessibleClientIds and getFilterDrops', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1']);
      mockStatisticsQueryService.getFilterDrops.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getFilterDrops(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      );

      expect(clientsService.getAccessibleClientIds).toHaveBeenCalled();
      expect(statisticsQueryService.getFilterDrops).toHaveBeenCalled();
    });
  });

  describe('getEntityEvents', () => {
    it('should call getAccessibleClientIds and getEntityEvents', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1']);
      mockStatisticsQueryService.getEntityEvents.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getEntityEvents(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      );

      expect(clientsService.getAccessibleClientIds).toHaveBeenCalled();
      expect(statisticsQueryService.getEntityEvents).toHaveBeenCalled();
    });

    it('should pass search param to getChatIo when provided', async () => {
      mockClientsService.getAccessibleClientIds.mockResolvedValue(['c1']);
      mockStatisticsQueryService.getChatIo.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getChatIo(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'query',
        undefined,
        undefined,
        {} as never,
      );

      expect(statisticsQueryService.getChatIo).toHaveBeenCalledWith(
        ['c1'],
        expect.objectContaining({ search: 'query' }),
      );
    });
  });
});
