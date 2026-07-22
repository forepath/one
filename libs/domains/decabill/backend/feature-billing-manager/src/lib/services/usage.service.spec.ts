import { BadRequestException } from '@nestjs/common';

import { UsageService } from './usage.service';

describe('UsageService', () => {
  const usageRecordsRepository = {
    findLatestForSubscription: jest.fn(),
    create: jest.fn(),
  };
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const service = new UsageService(
    usageRecordsRepository as never,
    subscriptionsRepository as never,
    servicePlansRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects usage records for advance-billed subscriptions', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: true });

    await expect(
      service.createUsage({
        subscriptionId: 'sub-1',
        periodStart: new Date(),
        periodEnd: new Date(),
        usageSource: 'admin',
        usagePayload: { totalCost: 1 },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(usageRecordsRepository.create).not.toHaveBeenCalled();
  });

  it('creates usage records for arrear-billed subscriptions', async () => {
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({ id: 'sub-1', planId: 'plan-1' });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({ id: 'plan-1', billInAdvance: false });
    usageRecordsRepository.create.mockResolvedValue({ id: 'usage-1' });

    const dto = {
      subscriptionId: 'sub-1',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-02-01'),
      usageSource: 'admin',
      usagePayload: { totalCost: 1 },
    };

    await expect(service.createUsage(dto)).resolves.toEqual({ id: 'usage-1' });
    expect(usageRecordsRepository.create).toHaveBeenCalledWith(dto);
  });
});
