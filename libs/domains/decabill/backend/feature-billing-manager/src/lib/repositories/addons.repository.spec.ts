import { NotFoundException } from '@nestjs/common';

import { AddonsRepository } from './addons.repository';

const createMockQueryBuilder = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
});

describe('AddonsRepository', () => {
  const mockQueryBuilder = createMockQueryBuilder();
  const typeorm = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
  };
  const repository = new AddonsRepository(typeorm as never);

  beforeEach(() => {
    jest.clearAllMocks();
    typeorm.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  it('findByIdOrThrow returns entity or throws', async () => {
    typeorm.findOne.mockResolvedValueOnce({ id: 'a-1' });
    await expect(repository.findByIdOrThrow('a-1')).resolves.toEqual({ id: 'a-1' });
    expect(typeorm.findOne).toHaveBeenCalledWith({ where: { id: 'a-1', tenantId: 'default' } });

    typeorm.findOne.mockResolvedValueOnce(null);
    await expect(repository.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
  });

  it('findById and findByKey delegate to typeorm', async () => {
    typeorm.findOne.mockResolvedValueOnce({ id: 'a-1' });
    await expect(repository.findById('a-1')).resolves.toEqual({ id: 'a-1' });

    typeorm.findOne.mockResolvedValueOnce({ key: 'av' });
    await expect(repository.findByKey('av')).resolves.toEqual({ key: 'av' });
  });

  it('findByIds returns empty for empty input and queries otherwise', async () => {
    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(typeorm.find).not.toHaveBeenCalled();

    typeorm.find.mockResolvedValueOnce([{ id: 'a-1' }]);
    await expect(repository.findByIds(['a-1'])).resolves.toEqual([{ id: 'a-1' }]);
    expect(typeorm.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'default' }),
      }),
    );
  });

  it('findAll and findActive apply pagination', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([]);
    await repository.findAll(5, 10);
    expect(mockQueryBuilder.take).toHaveBeenCalledWith(5);
    expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);

    typeorm.find.mockResolvedValue([]);
    await repository.findActive(20, 0);
    expect(typeorm.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'default', isActive: true },
        take: 20,
        skip: 0,
        order: { name: 'ASC' },
      }),
    );
  });

  it('create ignores incoming tenantId and saves', async () => {
    typeorm.create.mockImplementation((dto) => dto);
    typeorm.save.mockImplementation(async (entity) => entity);

    const result = await repository.create({ key: 'av', name: 'AV', tenantId: 'evil' } as never);

    expect(typeorm.create).toHaveBeenCalledWith(expect.objectContaining({ key: 'av', tenantId: 'default' }));
    expect(result.tenantId).toBe('default');
  });

  it('update merges and saves; delete removes after load', async () => {
    typeorm.findOne.mockResolvedValue({ id: 'a-1', name: 'Old', tenantId: 'default' });
    typeorm.save.mockImplementation(async (entity) => entity);
    typeorm.remove.mockResolvedValue(undefined);

    const updated = await repository.update('a-1', { name: 'New', tenantId: 'evil' } as never);

    expect(updated.name).toBe('New');
    expect(updated.tenantId).toBe('default');

    await repository.delete('a-1');
    expect(typeorm.remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'a-1' }));
  });
});
