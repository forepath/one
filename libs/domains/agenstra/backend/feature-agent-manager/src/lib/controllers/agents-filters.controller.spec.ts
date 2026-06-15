import { Test, TestingModule } from '@nestjs/testing';

import { CreateRegexFilterRuleDto } from '../dto/create-regex-filter-rule.dto';
import { UpdateRegexFilterRuleDto } from '../dto/update-regex-filter-rule.dto';
import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';
import { AgentsFiltersService } from '../services/agents-filters.service';

import { AgentsFiltersController } from './agents-filters.controller';

describe('AgentsFiltersController', () => {
  let controller: AgentsFiltersController;
  const mockService = {
    list: jest.fn(),
    count: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const mockRow: RegexFilterRuleEntity = Object.assign(new RegexFilterRuleEntity(), {
    id: '11111111-1111-1111-1111-111111111111',
    pattern: 'foo',
    regexFlags: 'g',
    direction: 'incoming' as const,
    filterType: 'none' as const,
    replaceContent: null,
    priority: 0,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  });
  const expectedDto = {
    id: mockRow.id,
    pattern: mockRow.pattern,
    regexFlags: mockRow.regexFlags,
    direction: mockRow.direction,
    filterType: mockRow.filterType,
    replaceContent: mockRow.replaceContent,
    priority: mockRow.priority,
    createdAt: mockRow.createdAt.toISOString(),
    updatedAt: mockRow.updatedAt.toISOString(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsFiltersController],
      providers: [{ provide: AgentsFiltersService, useValue: mockService }],
    }).compile();

    controller = module.get(AgentsFiltersController);
  });

  describe('list', () => {
    it('maps entities to DTOs with default pagination', async () => {
      mockService.list.mockResolvedValue([mockRow]);
      const result = await controller.list(undefined, undefined);

      expect(mockService.list).toHaveBeenCalledWith(100, 0);
      expect(result).toEqual([expectedDto]);
    });

    it('passes custom limit and offset', async () => {
      mockService.list.mockResolvedValue([]);
      await controller.list(5, 15);
      expect(mockService.list).toHaveBeenCalledWith(5, 15);
    });
  });

  describe('count', () => {
    it('returns count from service', async () => {
      mockService.count.mockResolvedValue(12);
      await expect(controller.count()).resolves.toEqual({ count: 12 });
    });
  });

  describe('getOne', () => {
    it('maps entity to DTO', async () => {
      mockService.getById.mockResolvedValue(mockRow);
      const result = await controller.getOne(mockRow.id);

      expect(result).toEqual(expectedDto);
      expect(mockService.getById).toHaveBeenCalledWith(mockRow.id);
    });
  });

  describe('create', () => {
    it('maps created entity to DTO', async () => {
      const dto: CreateRegexFilterRuleDto = {
        pattern: 'a',
        direction: 'incoming',
        filterType: 'none',
      };

      mockService.create.mockResolvedValue(mockRow);
      const result = await controller.create(dto);

      expect(mockService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expectedDto);
    });
  });

  describe('update', () => {
    it('maps updated entity to DTO', async () => {
      const dto: UpdateRegexFilterRuleDto = { priority: 3 };

      mockService.update.mockResolvedValue(mockRow);
      const result = await controller.update(mockRow.id, dto);

      expect(mockService.update).toHaveBeenCalledWith(mockRow.id, dto);
      expect(result).toEqual(expectedDto);
    });
  });

  describe('delete', () => {
    it('delegates to service', async () => {
      mockService.delete.mockResolvedValue(undefined);
      await controller.delete(mockRow.id);
      expect(mockService.delete).toHaveBeenCalledWith(mockRow.id);
    });
  });
});
