import { ClientUsersRepository } from '@forepath/identity/backend';
import * as clientAccessUtils from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { StatisticsQueryService } from '../services/statistics-query.service';

import { ClientStatisticsController } from './client-statistics.controller';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return { ...actual, ensureClientAccess: jest.fn() };
});

describe('ClientStatisticsController', () => {
  let controller: ClientStatisticsController;
  let statisticsQueryService: jest.Mocked<StatisticsQueryService>;
  const mockStatisticsQueryService = {
    getClientSummary: jest.fn(),
    getClientChatIo: jest.fn(),
    getClientFilterDrops: jest.fn(),
    getClientEntityEvents: jest.fn(),
  };
  const mockClientsRepository = {};
  const mockClientUsersRepository = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientStatisticsController],
      providers: [
        { provide: ClientsRepository, useValue: mockClientsRepository },
        { provide: ClientUsersRepository, useValue: mockClientUsersRepository },
        { provide: StatisticsQueryService, useValue: mockStatisticsQueryService },
      ],
    }).compile();

    controller = module.get<ClientStatisticsController>(ClientStatisticsController);
    statisticsQueryService = module.get(StatisticsQueryService);
    jest.clearAllMocks();
  });

  describe('getSummary', () => {
    it('should call ensureClientAccess and return summary', async () => {
      (clientAccessUtils.ensureClientAccess as jest.Mock).mockResolvedValue({});
      mockStatisticsQueryService.getClientSummary.mockResolvedValue({
        totalMessages: 10,
        totalWords: 100,
        totalChars: 500,
        avgWordsPerMessage: 10,
        filterDropCount: 0,
        filterTypesBreakdown: [],
      });

      const result = await controller.getSummary('client-uuid', undefined, undefined, undefined, {} as never);

      expect(clientAccessUtils.ensureClientAccess).toHaveBeenCalledWith(
        mockClientsRepository,
        mockClientUsersRepository,
        'client-uuid',
        {},
      );
      expect(statisticsQueryService.getClientSummary).toHaveBeenCalledWith('client-uuid', {
        from: undefined,
        to: undefined,
        groupBy: undefined,
      });
      expect(result.totalMessages).toBe(10);
    });

    it('should throw 403 when ensureClientAccess throws', async () => {
      (clientAccessUtils.ensureClientAccess as jest.Mock).mockRejectedValue(
        new ForbiddenException('You do not have access to this client'),
      );

      await expect(controller.getSummary('client-uuid', undefined, undefined, undefined, {} as never)).rejects.toThrow(
        ForbiddenException,
      );

      expect(statisticsQueryService.getClientSummary).not.toHaveBeenCalled();
    });
  });

  describe('getChatIo', () => {
    it('should call ensureClientAccess and return chat I/O', async () => {
      (clientAccessUtils.ensureClientAccess as jest.Mock).mockResolvedValue({});
      mockStatisticsQueryService.getClientChatIo.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getChatIo(
        'client-uuid',
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

      expect(clientAccessUtils.ensureClientAccess).toHaveBeenCalledWith(
        mockClientsRepository,
        mockClientUsersRepository,
        'client-uuid',
        {},
      );
      expect(statisticsQueryService.getClientChatIo).toHaveBeenCalled();
    });
  });

  describe('getFilterDrops', () => {
    it('should call ensureClientAccess and return filter drops', async () => {
      (clientAccessUtils.ensureClientAccess as jest.Mock).mockResolvedValue({});
      mockStatisticsQueryService.getClientFilterDrops.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getFilterDrops(
        'client-uuid',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      );

      expect(clientAccessUtils.ensureClientAccess).toHaveBeenCalledWith(
        mockClientsRepository,
        mockClientUsersRepository,
        'client-uuid',
        {},
      );
      expect(statisticsQueryService.getClientFilterDrops).toHaveBeenCalled();
    });
  });

  describe('getEntityEvents', () => {
    it('should call ensureClientAccess and return entity events', async () => {
      (clientAccessUtils.ensureClientAccess as jest.Mock).mockResolvedValue({});
      mockStatisticsQueryService.getClientEntityEvents.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getEntityEvents(
        'client-uuid',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {} as never,
      );

      expect(clientAccessUtils.ensureClientAccess).toHaveBeenCalledWith(
        mockClientsRepository,
        mockClientUsersRepository,
        'client-uuid',
        {},
      );
      expect(statisticsQueryService.getClientEntityEvents).toHaveBeenCalled();
    });

    it('should pass search param to getClientChatIo when provided', async () => {
      (clientAccessUtils.ensureClientAccess as jest.Mock).mockResolvedValue({});
      mockStatisticsQueryService.getClientChatIo.mockResolvedValue({
        data: [],
        total: 0,
        limit: 10,
        offset: 0,
      });

      await controller.getChatIo(
        'client-uuid',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'filter',
        undefined,
        undefined,
        {} as never,
      );

      expect(statisticsQueryService.getClientChatIo).toHaveBeenCalledWith(
        'client-uuid',
        expect.objectContaining({ search: 'filter' }),
      );
    });
  });
});
