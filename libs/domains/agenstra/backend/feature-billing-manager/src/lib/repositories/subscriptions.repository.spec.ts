import { NotFoundException } from '@nestjs/common';

import { SubscriptionStatus } from '../entities/subscription.entity';

import { SubscriptionsRepository } from './subscriptions.repository';

const createMockQueryBuilder = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
});

describe('SubscriptionsRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: any;
  let repository: SubscriptionsRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    repository = new SubscriptionsRepository(mockRepository);
  });

  it('finds subscription by id or throws', async () => {
    const subscription = { id: 'sub-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.findOne.mockResolvedValue(subscription);

    const result = await repository.findByIdOrThrow('sub-1');

    expect(result).toEqual(subscription);
  });

  it('throws when subscription not found', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    await expect(repository.findByIdOrThrow('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('finds subscription by id without throwing', async () => {
    const subscription = { id: 'sub-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.findOne.mockResolvedValue(subscription);

    const result = await repository.findById('sub-1');

    expect(result).toEqual(subscription);
  });

  it('returns null when not found', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    const result = await repository.findById('nonexistent');

    expect(result).toBeNull();
  });

  it('finds all by user with pagination', async () => {
    const subscriptions = [{ id: 'sub-1' }, { id: 'sub-2' }];

    mockRepository.find.mockResolvedValue(subscriptions);

    const result = await repository.findAllByUser('user-1', 10, 0);

    expect(result).toEqual(subscriptions);
    expect(mockRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        take: 10,
        skip: 0,
      }),
    );
  });

  it('creates subscription', async () => {
    const dto = { userId: 'user-1', planId: 'plan-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.create.mockReturnValue(dto);
    mockRepository.save.mockResolvedValue({ id: 'sub-1', ...dto });

    const result = await repository.create(dto);

    expect(result.id).toBe('sub-1');
  });

  it('updates subscription', async () => {
    const existing = { id: 'sub-1', status: SubscriptionStatus.ACTIVE };

    mockRepository.findOne.mockResolvedValue(existing);
    mockRepository.save.mockResolvedValue({ ...existing, status: SubscriptionStatus.PENDING_CANCEL });

    const result = await repository.update('sub-1', { status: SubscriptionStatus.PENDING_CANCEL });

    expect(result.status).toBe(SubscriptionStatus.PENDING_CANCEL);
  });

  it('finds subscriptions due for billing', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.ACTIVE }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date();
    const result = await repository.findDueForBilling(now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('subscription.status = :status', {
      status: 'active',
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.nextBillingAt <= :now', {
      now,
    });
  });

  it('finds subscriptions due for cancellation', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.PENDING_CANCEL }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date();
    const result = await repository.findDueForCancellation(now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.where).toHaveBeenCalledWith('subscription.status = :status', {
      status: 'pending_cancel',
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.cancelEffectiveAt <= :now', { now });
  });

  it('finds upcoming renewals within days', async () => {
    const subscriptions = [{ id: 'sub-1', status: SubscriptionStatus.ACTIVE }];

    mockQueryBuilder.getMany.mockResolvedValue(subscriptions);

    const now = new Date('2024-01-01');
    const result = await repository.findUpcomingRenewals(3, now, 100);

    expect(result).toEqual(subscriptions);
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('subscription.nextBillingAt > :now', {
      now,
    });
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'subscription.nextBillingAt <= :futureDate',
      expect.objectContaining({ futureDate: expect.any(Date) }),
    );
  });
});
