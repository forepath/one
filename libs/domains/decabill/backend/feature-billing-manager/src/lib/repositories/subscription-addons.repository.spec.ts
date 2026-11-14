import { NotFoundException } from '@nestjs/common';

import { SubscriptionAddonsRepository } from './subscription-addons.repository';

describe('SubscriptionAddonsRepository', () => {
  const typeorm = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
  };
  const repository = new SubscriptionAddonsRepository(typeorm as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('findByIdOrThrow returns entity or throws', async () => {
    typeorm.findOne.mockResolvedValueOnce({ id: 'sa-1' });
    await expect(repository.findByIdOrThrow('sa-1')).resolves.toEqual({ id: 'sa-1' });
    expect(typeorm.findOne).toHaveBeenCalledWith({ where: { id: 'sa-1' }, relations: ['addon'] });

    typeorm.findOne.mockResolvedValueOnce(null);
    await expect(repository.findByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
  });

  it('findBySubscriptionId and active/billable variants query correctly', async () => {
    typeorm.find.mockResolvedValue([]);

    await repository.findBySubscriptionId('sub-1');
    expect(typeorm.find).toHaveBeenCalledWith({
      where: { subscriptionId: 'sub-1' },
      relations: ['addon'],
      order: { createdAt: 'ASC' },
    });

    await repository.findActiveBySubscriptionId('sub-1');
    expect(typeorm.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subscriptionId: 'sub-1' }),
        relations: ['addon'],
      }),
    );

    await repository.findBillableBySubscriptionId('sub-1');
    expect(typeorm.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ subscriptionId: 'sub-1' }),
      }),
    );
  });

  it('createMany returns empty for no rows and saves otherwise', async () => {
    await expect(repository.createMany([])).resolves.toEqual([]);
    expect(typeorm.create).not.toHaveBeenCalled();

    typeorm.create.mockReturnValue([{ id: 'sa-1' }]);
    typeorm.save.mockResolvedValue([{ id: 'sa-1' }]);
    await expect(repository.createMany([{ subscriptionId: 'sub-1', addonId: 'a-1' }])).resolves.toEqual([
      { id: 'sa-1' },
    ]);
  });

  it('update assigns fields and save persists entity', async () => {
    typeorm.findOne.mockResolvedValue({ id: 'sa-1', status: 'pending' });
    typeorm.save.mockImplementation(async (entity) => entity);

    const updated = await repository.update('sa-1', { status: 'active' });

    expect(updated.status).toBe('active');

    await expect(repository.save({ id: 'sa-1' } as never)).resolves.toEqual({ id: 'sa-1' });
  });

  it('countByAddonId delegates to typeorm count', async () => {
    typeorm.count.mockResolvedValue(3);
    await expect(repository.countByAddonId('a-1')).resolves.toBe(3);
    expect(typeorm.count).toHaveBeenCalledWith({ where: { addonId: 'a-1' } });
  });
});
