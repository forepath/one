import { NotFoundException } from '@nestjs/common';
import { runWithTenantId } from '@forepath/shared/backend';

import { CustomerProfilesRepository } from './customer-profiles.repository';

const createMockQueryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getMany: jest.fn(),
  getOne: jest.fn(),
});

describe('CustomerProfilesRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let repository: CustomerProfilesRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    repository = new CustomerProfilesRepository(mockRepository as never);
  });

  it('findByUserId returns profile for tenant', async () => {
    const profile = { id: 'profile-1', userId: 'user-1' };

    mockQueryBuilder.getOne.mockResolvedValue(profile);

    await expect(runWithTenantId('default', () => repository.findByUserId('user-1'))).resolves.toEqual(profile);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('user.tenant_id = :tenantId', { tenantId: 'default' });
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockQueryBuilder.getOne.mockResolvedValue(null);

    await expect(repository.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
  });

  it('findAll returns paginated profiles', async () => {
    const items = [{ id: 'profile-1' }];

    mockQueryBuilder.getCount.mockResolvedValue(1);
    mockQueryBuilder.getMany.mockResolvedValue(items);

    const result = await repository.findAll(10, 0);

    expect(result).toEqual({ items, total: 1 });
  });

  it('create saves profile', async () => {
    const dto = { userId: 'user-1', firstName: 'Jane' };

    const result = await repository.create(dto);

    expect(result).toEqual(dto);
    expect(mockRepository.save).toHaveBeenCalled();
  });

  it('update merges profile fields', async () => {
    const profile = { id: 'profile-1', userId: 'user-1', country: 'US' };

    mockQueryBuilder.getOne.mockResolvedValue(profile);

    const result = await repository.update('profile-1', { country: 'DE' });

    expect(result.country).toBe('DE');
  });

  it('delete removes profile', async () => {
    mockQueryBuilder.getOne.mockResolvedValue({ id: 'profile-1' });

    await repository.delete('profile-1');

    expect(mockRepository.delete).toHaveBeenCalledWith('profile-1');
  });
});
