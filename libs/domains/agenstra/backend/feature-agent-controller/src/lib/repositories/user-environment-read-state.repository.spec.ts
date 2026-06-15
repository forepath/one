import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UserEnvironmentReadStateEntity } from '../entities/user-environment-read-state.entity';

import { UserEnvironmentReadStateRepository } from './user-environment-read-state.repository';

describe('UserEnvironmentReadStateRepository', () => {
  let repository: UserEnvironmentReadStateRepository;
  const mockRow: UserEnvironmentReadStateEntity = {
    id: 'state-1',
    userId: 'user-1',
    clientId: 'client-1',
    agentId: 'agent-1',
    lastReadAt: new Date('2026-01-01T00:00:00.000Z'),
    lastReadAgentMessageId: 'msg-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const mockTypeOrmRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEnvironmentReadStateRepository,
        {
          provide: getRepositoryToken(UserEnvironmentReadStateEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get(UserEnvironmentReadStateRepository);
    jest.clearAllMocks();
  });

  describe('findByUserId', () => {
    it('returns rows for user', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([mockRow]);

      const result = await repository.findByUserId('user-1');

      expect(result).toEqual([mockRow]);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });
  });

  describe('findOne', () => {
    it('returns matching row', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockRow);

      const result = await repository.findOne('user-1', 'client-1', 'agent-1');

      expect(result).toEqual(mockRow);
    });
  });

  describe('upsertReadState', () => {
    it('updates existing row', async () => {
      const updatedAt = new Date('2026-02-01T00:00:00.000Z');

      mockTypeOrmRepository.findOne.mockResolvedValue({ ...mockRow });
      mockTypeOrmRepository.save.mockImplementation(async (row) => row);

      const result = await repository.upsertReadState({
        userId: 'user-1',
        clientId: 'client-1',
        agentId: 'agent-1',
        lastReadAt: updatedAt,
        lastReadAgentMessageId: 'msg-2',
      });

      expect(result.lastReadAt).toEqual(updatedAt);
      expect(result.lastReadAgentMessageId).toBe('msg-2');
      expect(mockTypeOrmRepository.create).not.toHaveBeenCalled();
    });

    it('creates row when missing', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);
      mockTypeOrmRepository.create.mockReturnValue(mockRow);
      mockTypeOrmRepository.save.mockResolvedValue(mockRow);

      const result = await repository.upsertReadState({
        userId: 'user-1',
        clientId: 'client-1',
        agentId: 'agent-1',
        lastReadAt: new Date(),
      });

      expect(result).toEqual(mockRow);
      expect(mockTypeOrmRepository.create).toHaveBeenCalled();
    });
  });

  describe('findByUserAndClientIds', () => {
    it('returns empty array when no client ids', async () => {
      const result = await repository.findByUserAndClientIds('user-1', []);

      expect(result).toEqual([]);
      expect(mockTypeOrmRepository.find).not.toHaveBeenCalled();
    });

    it('queries with In filter', async () => {
      mockTypeOrmRepository.find.mockResolvedValue([mockRow]);

      await repository.findByUserAndClientIds('user-1', ['client-1', 'client-2']);

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 'user-1' }),
        }),
      );
    });
  });
});
