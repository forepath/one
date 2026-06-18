import { NotFoundException } from '@nestjs/common';

import { CustomerProfilesRepository } from './customer-profiles.repository';

const createMockQueryBuilder = () => ({
  leftJoin: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getCount: jest.fn(),
  getMany: jest.fn(),
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

  it('findByUserId returns profile', async () => {
    const profile = { id: 'profile-1', userId: 'user-1' };

    mockRepository.findOne.mockResolvedValue(profile);

    await expect(repository.findByUserId('user-1')).resolves.toEqual(profile);
  });

  it('findByIdOrThrow throws when missing', async () => {
    mockRepository.findOne.mockResolvedValue(null);

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

    mockRepository.findOne.mockResolvedValue(profile);

    const result = await repository.update('profile-1', { country: 'DE' });

    expect(result.country).toBe('DE');
  });

  it('delete removes profile', async () => {
    mockRepository.findOne.mockResolvedValue({ id: 'profile-1' });

    await repository.delete('profile-1');

    expect(mockRepository.delete).toHaveBeenCalledWith('profile-1');
  });
});
