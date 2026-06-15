import { UsersBillingDayRepository } from './users-billing-day.repository';

describe('UsersBillingDayRepository', () => {
  let mockQueryBuilder: {
    select: jest.Mock;
    where: jest.Mock;
    getRawMany: jest.Mock;
  };
  let mockRepository: { createQueryBuilder: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };
    mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      findOne: jest.fn(),
    };
  });

  describe('getEffectiveBillingDayForUser', () => {
    it('returns effective billing day from user createdAt and billingDayOfMonth', async () => {
      const createdAt = new Date('2024-03-15T12:00:00Z');

      mockRepository.findOne.mockResolvedValue({ createdAt, billingDayOfMonth: 20 });

      const repository = new UsersBillingDayRepository(mockRepository as never);
      const result = await repository.getEffectiveBillingDayForUser('user-1');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: ['createdAt', 'billingDayOfMonth'],
      });
      expect(result).toBe(20);
    });

    it('returns day from createdAt when billingDayOfMonth is null', async () => {
      const createdAt = new Date('2024-03-15T12:00:00Z');

      mockRepository.findOne.mockResolvedValue({ createdAt, billingDayOfMonth: null });

      const repository = new UsersBillingDayRepository(mockRepository as never);
      const result = await repository.getEffectiveBillingDayForUser('user-1');

      expect(result).toBe(15);
    });

    it('returns 1 when user not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const repository = new UsersBillingDayRepository(mockRepository as never);
      const result = await repository.getEffectiveBillingDayForUser('unknown');

      expect(result).toBe(1);
    });
  });

  it('findUserIdsWithBillingDay returns user ids for matching effective billing day', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    const repository = new UsersBillingDayRepository(mockRepository as never);
    const result = await repository.findUserIdsWithBillingDay(10);

    expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('u');
    expect(mockQueryBuilder.select).toHaveBeenCalledWith('u.id', 'id');
    expect(mockQueryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('COALESCE'),
      expect.objectContaining({ day: 10 }),
    );
    expect(result).toEqual(['user-1', 'user-2']);
  });

  it('findUserIdsWithBillingDay returns empty array when no users match', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([]);

    const repository = new UsersBillingDayRepository(mockRepository as never);
    const result = await repository.findUserIdsWithBillingDay(28);

    expect(result).toEqual([]);
  });
});
