import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RegexFilterRuleEntity } from '../entities/regex-filter-rule.entity';

import { RegexFilterRulesRepository } from './regex-filter-rules.repository';

describe('RegexFilterRulesRepository', () => {
  let repository: RegexFilterRulesRepository;
  const typeOrm = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const row: RegexFilterRuleEntity = Object.assign(new RegexFilterRuleEntity(), {
    id: 'rule-1',
    pattern: 'x',
    regexFlags: 'g',
    direction: 'incoming' as const,
    filterType: 'none' as const,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegexFilterRulesRepository,
        { provide: getRepositoryToken(RegexFilterRuleEntity), useValue: typeOrm },
      ],
    }).compile();

    repository = module.get(RegexFilterRulesRepository);
  });

  describe('findByIdOrThrow', () => {
    it('returns entity when found', async () => {
      typeOrm.findOne.mockResolvedValue(row);
      await expect(repository.findByIdOrThrow('rule-1')).resolves.toEqual(row);
      expect(typeOrm.findOne).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
    });

    it('throws NotFoundException when missing', async () => {
      typeOrm.findOne.mockResolvedValue(null);
      await expect(repository.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAllOrdered', () => {
    it('orders by priority and createdAt', async () => {
      typeOrm.find.mockResolvedValue([row]);
      const result = await repository.findAllOrdered();

      expect(result).toEqual([row]);
      expect(typeOrm.find).toHaveBeenCalledWith({
        order: { priority: 'ASC', createdAt: 'ASC' },
      });
    });
  });

  describe('findAll', () => {
    it('applies take, skip and order', async () => {
      typeOrm.find.mockResolvedValue([]);
      await repository.findAll(20, 40);
      expect(typeOrm.find).toHaveBeenCalledWith({
        take: 20,
        skip: 40,
        order: { priority: 'ASC', createdAt: 'ASC' },
      });
    });
  });

  describe('count', () => {
    it('delegates to TypeORM count', async () => {
      typeOrm.count.mockResolvedValue(7);
      await expect(repository.count()).resolves.toBe(7);
    });
  });

  describe('create', () => {
    it('creates and saves', async () => {
      typeOrm.create.mockReturnValue(row);
      typeOrm.save.mockResolvedValue(row);
      const result = await repository.create({
        pattern: 'a',
        regexFlags: 'g',
        direction: 'incoming',
        filterType: 'none',
      });

      expect(typeOrm.create).toHaveBeenCalled();
      expect(typeOrm.save).toHaveBeenCalledWith(row);
      expect(result).toEqual(row);
    });
  });

  describe('update', () => {
    it('merges and saves', async () => {
      typeOrm.findOne.mockResolvedValue({ ...row });
      typeOrm.save.mockImplementation(async (r: RegexFilterRuleEntity) => r);
      const result = await repository.update('rule-1', { priority: 9 });

      expect(result.priority).toBe(9);
      expect(typeOrm.save).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes after find', async () => {
      typeOrm.findOne.mockResolvedValue(row);
      typeOrm.remove.mockResolvedValue(row);
      await repository.delete('rule-1');
      expect(typeOrm.remove).toHaveBeenCalledWith(row);
    });
  });
});
