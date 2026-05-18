import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TicketAutomationRunEntity } from '../entities/ticket-automation-run.entity';

import { TicketAutomationRunsStatusRepository } from './ticket-automation-runs-status.repository';

describe('TicketAutomationRunsStatusRepository', () => {
  let repository: TicketAutomationRunsStatusRepository;
  const mockQb = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
    getRawMany: jest.fn(),
  };
  const mockTypeOrmRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketAutomationRunsStatusRepository,
        {
          provide: getRepositoryToken(TicketAutomationRunEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get(TicketAutomationRunsStatusRepository);
    jest.clearAllMocks();
    mockTypeOrmRepository.createQueryBuilder.mockReturnValue(mockQb);
  });

  describe('findLatestUpdatedAtByAgent', () => {
    it('returns null when no runs', async () => {
      mockQb.getRawOne.mockResolvedValue({ maxUpdatedAt: null });

      const result = await repository.findLatestUpdatedAtByAgent('client-1', 'agent-1');

      expect(result).toBeNull();
    });

    it('returns Date from raw row', async () => {
      const date = new Date('2026-01-15T12:00:00.000Z');

      mockQb.getRawOne.mockResolvedValue({ maxUpdatedAt: date });

      const result = await repository.findLatestUpdatedAtByAgent('client-1', 'agent-1');

      expect(result).toEqual(date);
    });

    it('parses string timestamp', async () => {
      mockQb.getRawOne.mockResolvedValue({ maxUpdatedAt: '2026-01-15T12:00:00.000Z' });

      const result = await repository.findLatestUpdatedAtByAgent('client-1', 'agent-1');

      expect(result).toEqual(new Date('2026-01-15T12:00:00.000Z'));
    });
  });

  describe('findLatestUpdatedAtByClient', () => {
    it('builds map keyed by agent id', async () => {
      const d1 = new Date('2026-01-01T00:00:00.000Z');
      const d2 = new Date('2026-01-02T00:00:00.000Z');

      mockQb.getRawMany.mockResolvedValue([
        { agentId: 'agent-1', maxUpdatedAt: d1 },
        { agentId: 'agent-2', maxUpdatedAt: d2 },
      ]);

      const result = await repository.findLatestUpdatedAtByClient('client-1');

      expect(result.get('agent-1')).toEqual(d1);
      expect(result.get('agent-2')).toEqual(d2);
    });
  });
});
