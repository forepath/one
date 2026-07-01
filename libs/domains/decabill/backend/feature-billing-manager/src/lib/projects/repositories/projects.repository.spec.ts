import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { ProjectsRepository } from './projects.repository';

const createMockQueryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getMany: jest.fn(),
  getOne: jest.fn(),
  select: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
});

describe('ProjectsRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { createQueryBuilder: jest.Mock };
  };
  let repository: ProjectsRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      manager: {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      },
    };
    repository = new ProjectsRepository(mockRepository as never);
  });

  it('findByIdOrThrow applies tenant filter via project user join', async () => {
    const project = { id: 'project-1', userId: 'user-1' };

    mockQueryBuilder.getOne.mockResolvedValue(project);

    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('project-1'))).resolves.toEqual(project);
    expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith('users', 'user', 'user.id = project.user_id');
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);

    await expect(repository.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
  });

  it('findAllByUser scopes to user and tenant', async () => {
    mockQueryBuilder.getCount.mockResolvedValue(1);
    mockQueryBuilder.getMany.mockResolvedValue([{ id: 'project-1' }]);

    const result = await runWithTenantId('tenant-a', () => repository.findAllByUser('user-1', 10, 0));

    expect(result.total).toBe(1);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('project.user_id = :userId', { userId: 'user-1' });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'tenant-a' });
  });
});
