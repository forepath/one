import { NotFoundException } from '@nestjs/common';

import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';

import { PaymentAttemptsRepository } from './payment-attempts.repository';

describe('PaymentAttemptsRepository', () => {
  let mockRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };
  });

  it('create saves payment attempt', async () => {
    const dto = {
      invoiceId: 'inv-1',
      processor: 'stripe',
      externalId: 'cs_1',
      status: PaymentAttemptStatus.PENDING,
    };
    const created = { id: 'attempt-1', ...dto };

    mockRepository.create.mockReturnValue(created);
    mockRepository.save.mockResolvedValue(created);

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await repository.create(dto);

    expect(result).toEqual(created);
  });

  it('findByExternalId queries processor and external id', async () => {
    mockRepository.findOne.mockResolvedValue({ id: 'attempt-1' });

    const repository = new PaymentAttemptsRepository(mockRepository as never);
    const result = await repository.findByExternalId('stripe', 'cs_1');

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { processor: 'stripe', externalId: 'cs_1' },
    });
    expect(result).toEqual({ id: 'attempt-1' });
  });

  it('update throws when attempt not found', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    const repository = new PaymentAttemptsRepository(mockRepository as never);

    await expect(repository.update('missing', { status: PaymentAttemptStatus.SUCCEEDED })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
