import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { AdminSubscriptionMetersController } from './admin-subscription-meters.controller';

describe('AdminSubscriptionMetersController (meter entries list)', () => {
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const reqWithAdmin = { user: { id: 'admin-1', roles: ['admin'] } };
  const reqWithUser = { user: { id: 'user-1', roles: ['user'] } };
  const page = { items: [{ id: 'usage-1' }], total: 30, limit: 25, offset: 25 };
  let subscriptionsRepository: { findByIdOrThrow: jest.Mock };
  let usageService: { listMeterEntries: jest.Mock };
  let controller: AdminSubscriptionMetersController;

  beforeEach(() => {
    subscriptionsRepository = { findByIdOrThrow: jest.fn().mockResolvedValue({ id: subscriptionId }) };
    usageService = { listMeterEntries: jest.fn().mockResolvedValue(page) };
    controller = new AdminSubscriptionMetersController(
      subscriptionsRepository as never,
      usageService as never,
      {} as never,
    );
  });

  it('passes limit / offset through and returns the page with its total', async () => {
    const result = await controller.listEntries(subscriptionId, reqWithAdmin as never, 25, 25);

    expect(subscriptionsRepository.findByIdOrThrow).toHaveBeenCalledWith(subscriptionId);
    expect(usageService.listMeterEntries).toHaveBeenCalledWith(subscriptionId, 25, 25);
    expect(result).toEqual(page);
  });

  it('defaults to limit 10 / offset 0 and clamps the limit to 100', async () => {
    await controller.listEntries(subscriptionId, reqWithAdmin as never);
    expect(usageService.listMeterEntries).toHaveBeenLastCalledWith(subscriptionId, 10, 0);

    await controller.listEntries(subscriptionId, reqWithAdmin as never, 5000, -3);
    expect(usageService.listMeterEntries).toHaveBeenLastCalledWith(subscriptionId, 100, 0);

    await controller.listEntries(subscriptionId, reqWithAdmin as never, 0, 0);
    expect(usageService.listMeterEntries).toHaveBeenLastCalledWith(subscriptionId, 1, 0);
  });

  it('stays admin-only (non-admins are rejected before any lookup)', async () => {
    await expect(controller.listEntries(subscriptionId, reqWithUser as never, 25, 0)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(subscriptionsRepository.findByIdOrThrow).not.toHaveBeenCalled();
    expect(usageService.listMeterEntries).not.toHaveBeenCalled();
  });

  it('still 404s for an unknown subscription', async () => {
    subscriptionsRepository.findByIdOrThrow.mockRejectedValue(new NotFoundException());

    await expect(controller.listEntries(subscriptionId, reqWithAdmin as never, 25, 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(usageService.listMeterEntries).not.toHaveBeenCalled();
  });
});
