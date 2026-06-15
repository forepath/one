import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DeploymentRunEntity } from '../entities/deployment-run.entity';

import { DeploymentRunsRepository } from './deployment-runs.repository';

describe('DeploymentRunsRepository', () => {
  let repository: DeploymentRunsRepository;
  const mockRun: DeploymentRunEntity = {
    id: 'run-uuid',
    configurationId: 'config-uuid',
    providerRunId: '789',
    runName: 'Pipeline #789',
    status: 'completed',
    conclusion: 'success',
    ref: 'main',
    sha: 'abc123',
    workflowId: '123',
    workflowName: 'CI Workflow',
    startedAt: new Date('2024-01-01T00:01:00Z'),
    completedAt: new Date('2024-01-01T00:05:00Z'),
    htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    configuration: {} as any,
  };
  const mockTypeOrmRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentRunsRepository,
        {
          provide: getRepositoryToken(DeploymentRunEntity),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<DeploymentRunsRepository>(DeploymentRunsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByConfigurationId', () => {
    it('should return runs with pagination', async () => {
      const runs = [mockRun];

      mockTypeOrmRepository.find.mockResolvedValue(runs);

      const result = await repository.findByConfigurationId('config-uuid', 50, 0);

      expect(result).toEqual(runs);
      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { configurationId: 'config-uuid' },
        take: 50,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should use default pagination values', async () => {
      const runs = [mockRun];

      mockTypeOrmRepository.find.mockResolvedValue(runs);

      await repository.findByConfigurationId('config-uuid');

      expect(mockTypeOrmRepository.find).toHaveBeenCalledWith({
        where: { configurationId: 'config-uuid' },
        take: 50,
        skip: 0,
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findByProviderRunId', () => {
    it('should return run when found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(mockRun);

      const result = await repository.findByProviderRunId('config-uuid', '789');

      expect(result).toEqual(mockRun);
      expect(mockTypeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { configurationId: 'config-uuid', providerRunId: '789' },
      });
    });

    it('should return null when not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByProviderRunId('config-uuid', 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create and save new run', async () => {
      const createData = {
        configurationId: 'config-uuid',
        providerRunId: '789',
        runName: 'Pipeline #789',
        status: 'queued',
        ref: 'main',
        sha: 'abc123',
      };
      const createdRun = { ...mockRun, ...createData };

      mockTypeOrmRepository.create.mockReturnValue(createdRun);
      mockTypeOrmRepository.save.mockResolvedValue(createdRun);

      const result = await repository.create(createData);

      expect(result).toEqual(createdRun);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(createData);
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(createdRun);
    });
  });

  describe('update', () => {
    it('should update existing run', async () => {
      const updateData = { status: 'completed', conclusion: 'success' };
      const updatedRun = { ...mockRun, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockRun);
      mockTypeOrmRepository.save.mockResolvedValue(updatedRun);

      const result = await repository.update('run-uuid', updateData);

      expect(result.status).toBe('completed');
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });

    it('should throw error when run not found', async () => {
      mockTypeOrmRepository.findOne.mockResolvedValue(null);

      await expect(repository.update('non-existent', { status: 'completed' })).rejects.toThrow(
        'Deployment run with ID non-existent not found',
      );
    });
  });

  describe('upsertByProviderRunId', () => {
    it('should create new run when not exists', async () => {
      const createData = {
        runName: 'Pipeline #789',
        status: 'queued',
        ref: 'main',
        sha: 'abc123',
      };
      const createdRun = { ...mockRun, ...createData };

      mockTypeOrmRepository.findOne.mockResolvedValue(null);
      mockTypeOrmRepository.create.mockReturnValue(createdRun);
      mockTypeOrmRepository.save.mockResolvedValue(createdRun);

      const result = await repository.upsertByProviderRunId('config-uuid', '789', createData);

      expect(result).toEqual(createdRun);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          configurationId: 'config-uuid',
          providerRunId: '789',
        }),
      );
    });

    it('should update existing run when exists', async () => {
      const updateData = { status: 'completed', conclusion: 'success' };
      const updatedRun = { ...mockRun, ...updateData };

      mockTypeOrmRepository.findOne.mockResolvedValue(mockRun);
      mockTypeOrmRepository.save.mockResolvedValue(updatedRun);

      const result = await repository.upsertByProviderRunId('config-uuid', '789', updateData);

      expect(result.status).toBe('completed');
      expect(mockTypeOrmRepository.save).toHaveBeenCalled();
    });
  });
});
