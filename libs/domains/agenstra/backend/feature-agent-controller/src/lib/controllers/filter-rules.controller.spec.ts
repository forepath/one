jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend') as Record<string, unknown>;

  return {
    ...actual,
    getUserFromRequest: jest.fn(),
  };
});

import * as identity from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';

import { CreateFilterRuleDto } from '../dto/filter-rules/create-filter-rule.dto';
import { FilterRuleResponseDto } from '../dto/filter-rules/filter-rule-response.dto';
import { UpdateFilterRuleDto } from '../dto/filter-rules/update-filter-rule.dto';
import { FilterRulesService } from '../services/filter-rules.service';

import { FilterRulesController } from './filter-rules.controller';

const getUserFromRequestMock = identity.getUserFromRequest as jest.MockedFunction<typeof identity.getUserFromRequest>;

describe('FilterRulesController', () => {
  const mockService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as FilterRulesService;
  let controller: FilterRulesController;
  const adminReq = {} as Parameters<FilterRulesController['list']>[0];
  const sampleRule: FilterRuleResponseDto = {
    id: '11111111-1111-1111-1111-111111111111',
    pattern: 'x',
    regexFlags: 'g',
    direction: 'incoming',
    filterType: 'none',
    priority: 0,
    enabled: true,
    isGlobal: true,
    workspaceIds: [],
    sync: { pending: 0, synced: 1, failed: 0 },
    workspaceSync: [{ clientId: '22222222-2222-2222-2222-222222222222', syncStatus: 'synced' }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getUserFromRequestMock.mockReturnValue({
      userId: 'user-1',
      userRole: identity.UserRole.ADMIN,
      isApiKeyAuth: false,
    } as identity.UserInfoFromRequest);
    controller = new FilterRulesController(mockService);
  });

  describe('authorization', () => {
    it('throws ForbiddenException for non-admin session users', async () => {
      getUserFromRequestMock.mockReturnValueOnce({
        userId: 'user-1',
        userRole: identity.UserRole.USER,
        isApiKeyAuth: false,
      } as identity.UserInfoFromRequest);
      await expect(controller.list(adminReq)).rejects.toThrow(ForbiddenException);
      expect(mockService.findAll).not.toHaveBeenCalled();
    });

    it('allows API key authentication without admin role', async () => {
      getUserFromRequestMock.mockReturnValueOnce({
        isApiKeyAuth: true,
      } as identity.UserInfoFromRequest);
      (mockService.findAll as jest.Mock).mockResolvedValue([]);
      await controller.list(adminReq);
      expect(mockService.findAll).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('uses default limit and offset', async () => {
      (mockService.findAll as jest.Mock).mockResolvedValue([sampleRule]);
      const result = await controller.list(adminReq, undefined, undefined);

      expect(result).toEqual([sampleRule]);
      expect(mockService.findAll).toHaveBeenCalledWith(10, 0);
    });

    it('passes explicit limit and offset', async () => {
      (mockService.findAll as jest.Mock).mockResolvedValue([]);
      await controller.list(adminReq, 25, 5);
      expect(mockService.findAll).toHaveBeenCalledWith(25, 5);
    });
  });

  describe('getOne', () => {
    it('returns a single rule', async () => {
      (mockService.findOne as jest.Mock).mockResolvedValue(sampleRule);
      const result = await controller.getOne(sampleRule.id, adminReq);

      expect(result).toEqual(sampleRule);
      expect(mockService.findOne).toHaveBeenCalledWith(sampleRule.id);
    });
  });

  describe('create', () => {
    it('returns created rule from service', async () => {
      const dto: CreateFilterRuleDto = {
        pattern: 'a',
        direction: 'incoming',
        filterType: 'none',
        isGlobal: true,
      };

      (mockService.create as jest.Mock).mockResolvedValue(sampleRule);
      const result = await controller.create(dto, adminReq);

      expect(result).toEqual(sampleRule);
      expect(mockService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('update', () => {
    it('delegates to service', async () => {
      const dto: UpdateFilterRuleDto = { enabled: false };
      const updated = { ...sampleRule, enabled: false };

      (mockService.update as jest.Mock).mockResolvedValue(updated);
      const result = await controller.update(sampleRule.id, dto, adminReq);

      expect(result).toEqual(updated);
      expect(mockService.update).toHaveBeenCalledWith(sampleRule.id, dto);
    });
  });

  describe('delete', () => {
    it('delegates to service', async () => {
      (mockService.delete as jest.Mock).mockResolvedValue(undefined);
      await controller.delete(sampleRule.id, adminReq);
      expect(mockService.delete).toHaveBeenCalledWith(sampleRule.id);
    });
  });
});
