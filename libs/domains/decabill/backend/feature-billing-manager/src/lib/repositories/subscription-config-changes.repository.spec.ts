import { SubscriptionConfigChangesRepository } from './subscription-config-changes.repository';

function createUpdateBuilder(affected: number) {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
}

function createSelectBuilder(result: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(result),
    getMany: jest.fn().mockResolvedValue(result),
    getRawMany: jest.fn().mockResolvedValue(result),
  };
}

describe('SubscriptionConfigChangesRepository', () => {
  const typeorm = {
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const repository = new SubscriptionConfigChangesRepository(typeorm as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create persists the entity', async () => {
    typeorm.create.mockImplementation((dto) => dto);
    typeorm.save.mockImplementation(async (entity) => entity);

    await expect(repository.create({ subscriptionId: 'sub-1', status: 'pending' })).resolves.toEqual({
      subscriptionId: 'sub-1',
      status: 'pending',
    });
  });

  it('findPendingIds maps raw rows to ids', async () => {
    typeorm.createQueryBuilder.mockReturnValue(createSelectBuilder([{ id: 'c-1' }, { id: 'c-2' }]));

    await expect(repository.findPendingIds()).resolves.toEqual(['c-1', 'c-2']);
  });

  it('findStuckProcessing filters by the processing start cut-off', async () => {
    const builder = createSelectBuilder([{ id: 'c-1' }]);
    const before = new Date('2026-01-01T00:00:00.000Z');

    typeorm.createQueryBuilder.mockReturnValue(builder);

    await expect(repository.findStuckProcessing(before)).resolves.toEqual([{ id: 'c-1' }]);
    expect(builder.andWhere).toHaveBeenCalledWith('change.processingStartedAt < :before', { before });
  });

  it('claimForProcessing returns null when another worker won the race', async () => {
    typeorm.createQueryBuilder.mockReturnValue(createUpdateBuilder(0));

    await expect(repository.claimForProcessing('c-1')).resolves.toBeNull();
  });

  it('claimForProcessing moves pending to processing and reloads the row', async () => {
    const updateBuilder = createUpdateBuilder(1);

    typeorm.createQueryBuilder
      .mockReturnValueOnce(updateBuilder)
      .mockReturnValueOnce(createSelectBuilder({ id: 'c-1', status: 'processing' }));

    await expect(repository.claimForProcessing('c-1')).resolves.toEqual({ id: 'c-1', status: 'processing' });
    expect(updateBuilder.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing', processingStartedAt: expect.any(Date) }),
    );
    expect(updateBuilder.andWhere).toHaveBeenCalledWith('status = :expected', { expected: 'pending' });
  });

  it('transitionFromProcessing only applies while the row is still processing under the claim generation', async () => {
    const lostClaim = createUpdateBuilder(0);

    typeorm.createQueryBuilder.mockReturnValueOnce(lostClaim);
    await expect(repository.transitionFromProcessing('c-1', 'completed', {}, 0)).resolves.toBe(false);
    expect(lostClaim.andWhere).toHaveBeenCalledWith('status = :expected', { expected: 'processing' });
    expect(lostClaim.andWhere).toHaveBeenCalledWith('reclaim_count = :claimGeneration', { claimGeneration: 0 });

    const wonClaim = createUpdateBuilder(1);

    typeorm.createQueryBuilder.mockReturnValueOnce(wonClaim);
    await expect(
      repository.transitionFromProcessing('c-1', 'failed', { errorCode: 'CONFIG_CHANGE_FAILED' }, 2),
    ).resolves.toBe(true);
    expect(wonClaim.set).toHaveBeenCalledWith({ status: 'failed', errorCode: 'CONFIG_CHANGE_FAILED' });
    expect(wonClaim.andWhere).toHaveBeenCalledWith('reclaim_count = :claimGeneration', { claimGeneration: 2 });
  });

  it('appendAppliedStep is a no-op when the step is already recorded', async () => {
    typeorm.createQueryBuilder.mockReturnValue(createUpdateBuilder(0));

    await expect(repository.appendAppliedStep('c-1', 'resize', 0)).resolves.toBe(false);
  });

  it('appendAppliedStep appends atomically when the step is new', async () => {
    const builder = createUpdateBuilder(1);

    typeorm.createQueryBuilder.mockReturnValue(builder);

    await expect(repository.appendAppliedStep('c-1', 'resize', 1)).resolves.toBe(true);
    expect(builder.andWhere).toHaveBeenCalledWith('NOT (applied_steps @> to_jsonb(:stepKey::text))');
    expect(builder.andWhere).toHaveBeenCalledWith('reclaim_count = :claimGeneration', { claimGeneration: 1 });
    expect(builder.setParameter).toHaveBeenCalledWith('stepKey', 'resize');
  });

  it('claimBillingSlot reserves only while billing_outcome is null for the claim generation', async () => {
    const builder = createUpdateBuilder(1);

    typeorm.createQueryBuilder.mockReturnValue(builder);

    await expect(repository.claimBillingSlot('c-1', 0)).resolves.toBe(true);
    expect(builder.set).toHaveBeenCalledWith({ billingOutcome: 'deferred' });
    expect(builder.andWhere).toHaveBeenCalledWith('billing_outcome IS NULL');
    expect(builder.andWhere).toHaveBeenCalledWith('reclaim_count = :claimGeneration', { claimGeneration: 0 });
  });
});
