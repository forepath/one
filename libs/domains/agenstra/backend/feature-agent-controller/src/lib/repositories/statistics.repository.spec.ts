import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StatisticsAgentEntity } from '../entities/statistics-agent.entity';
import { StatisticsChatFilterDropEntity } from '../entities/statistics-chat-filter-drop.entity';
import { StatisticsChatFilterFlagEntity } from '../entities/statistics-chat-filter-flag.entity';
import { StatisticsChatIoEntity } from '../entities/statistics-chat-io.entity';
import { StatisticsClientUserEntity } from '../entities/statistics-client-user.entity';
import { StatisticsClientEntity } from '../entities/statistics-client.entity';
import { StatisticsEntityEventEntity } from '../entities/statistics-entity-event.entity';
import { StatisticsProvisioningReferenceEntity } from '../entities/statistics-provisioning-reference.entity';
import { StatisticsUserEntity } from '../entities/statistics-user.entity';

import { StatisticsRepository } from './statistics.repository';

const createMockQb = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
  getRawOne: jest.fn().mockResolvedValue(null),
  getRawMany: jest.fn().mockResolvedValue([]),
});
const createMockRepo = (qb: ReturnType<typeof createMockQb>) => ({
  createQueryBuilder: jest.fn().mockReturnValue(qb),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});
const entities = [
  StatisticsUserEntity,
  StatisticsClientEntity,
  StatisticsAgentEntity,
  StatisticsProvisioningReferenceEntity,
  StatisticsClientUserEntity,
  StatisticsChatIoEntity,
  StatisticsChatFilterDropEntity,
  StatisticsChatFilterFlagEntity,
  StatisticsEntityEventEntity,
];

describe('StatisticsRepository', () => {
  let repository: StatisticsRepository;
  let statisticsClientsQb: ReturnType<typeof createMockQb>;

  beforeEach(async () => {
    statisticsClientsQb = createMockQb();
    statisticsClientsQb.getMany.mockResolvedValue([{ id: 'sc-1' }, { id: 'sc-2' }]);

    const mockRepo = createMockRepo(statisticsClientsQb);
    const mockBaseRepo = {
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const providers = entities.map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue: entity === StatisticsClientEntity ? mockRepo : mockBaseRepo,
    }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatisticsRepository, ...providers],
    }).compile();

    repository = module.get<StatisticsRepository>(StatisticsRepository);
  });

  describe('findStatisticsClientIdsByOriginalIds', () => {
    it('should return statistics client IDs for given original client IDs', async () => {
      const result = await repository.findStatisticsClientIdsByOriginalIds(['oc-1', 'oc-2']);

      expect(result).toEqual(['sc-1', 'sc-2']);
      expect(statisticsClientsQb.where).toHaveBeenCalledWith('sc.original_client_id IN (:...ids)', {
        ids: ['oc-1', 'oc-2'],
      });
    });

    it('should return empty array when no original client IDs provided', async () => {
      const result = await repository.findStatisticsClientIdsByOriginalIds([]);

      expect(result).toEqual([]);
      expect(statisticsClientsQb.where).not.toHaveBeenCalled();
    });
  });
});

describe('StatisticsRepository filter breakdowns', () => {
  async function createRepository(dropsQb: ReturnType<typeof createMockQb>, flagsQb: ReturnType<typeof createMockQb>) {
    const providers = entities.map((entity) => ({
      provide: getRepositoryToken(entity),
      useValue:
        entity === StatisticsChatFilterDropEntity
          ? createMockRepo(dropsQb)
          : entity === StatisticsChatFilterFlagEntity
            ? createMockRepo(flagsQb)
            : createMockRepo(createMockQb()),
    }));
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatisticsRepository, ...providers],
    }).compile();

    return module.get<StatisticsRepository>(StatisticsRepository);
  }

  it('returns the filter display name with each drop breakdown entry (chart legends)', async () => {
    const dropsQb = createMockQb();

    dropsQb.getCount.mockResolvedValue(3);
    dropsQb.getRawMany
      .mockResolvedValueOnce([
        {
          filterType: 'pii-email',
          filterDisplayName: 'Personal data: email address',
          direction: 'incoming',
          count: '2',
        },
        { filterType: 'legacy', filterDisplayName: null, direction: 'outgoing', count: '1' },
      ])
      .mockResolvedValueOnce([{ filterType: 'pii-email' }, { filterType: 'legacy' }]);
    const repository = await createRepository(dropsQb, createMockQb());
    const result = await repository.queryFilterDropsAggregate({ statisticsClientIds: ['sc-1'] });

    expect(dropsQb.addSelect).toHaveBeenCalledWith('MAX(fd.filter_display_name)', 'filterDisplayName');
    expect(dropsQb.where).toHaveBeenCalledWith('fd.statistics_client_id IN (:...ids)', { ids: ['sc-1'] });
    expect(result.filterTypesBreakdown).toEqual([
      { filterType: 'pii-email', filterDisplayName: 'Personal data: email address', direction: 'incoming', count: 2 },
      { filterType: 'legacy', filterDisplayName: null, direction: 'outgoing', count: 1 },
    ]);
  });

  it('returns the filter display name with each flag breakdown entry', async () => {
    const flagsQb = createMockQb();

    flagsQb.getRawMany
      .mockResolvedValueOnce([
        { filter_type: 'pii-iban', filter_display_name: 'Bank account (IBAN)', direction: 'outgoing', count: '4' },
      ])
      .mockResolvedValueOnce([{ filter_type: 'pii-iban' }]);
    const repository = await createRepository(createMockQb(), flagsQb);
    const result = await repository.queryFilterFlagsAggregate({ statisticsClientIds: ['sc-1'] });

    expect(flagsQb.addSelect).toHaveBeenCalledWith('MAX(ff.filter_display_name)', 'filter_display_name');
    expect(flagsQb.where).toHaveBeenCalledWith('ff.statistics_client_id IN (:...ids)', { ids: ['sc-1'] });
    expect(result.filterTypesBreakdown).toEqual([
      { filterType: 'pii-iban', filterDisplayName: 'Bank account (IBAN)', direction: 'outgoing', count: 4 },
    ]);
  });

  it('queries nothing without accessible statistics clients', async () => {
    const dropsQb = createMockQb();
    const repository = await createRepository(dropsQb, createMockQb());

    await expect(repository.queryFilterDropsAggregate({ statisticsClientIds: [] })).resolves.toEqual({
      filterDropCount: 0,
      filterTypesBreakdown: [],
      uniqueFilterTypes: [],
    });
    expect(dropsQb.getRawMany).not.toHaveBeenCalled();
  });
});
