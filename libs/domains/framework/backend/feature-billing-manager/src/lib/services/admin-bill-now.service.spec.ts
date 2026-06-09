import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

import { AdminBillNowService } from './admin-bill-now.service';

describe('AdminBillNowService', () => {
  const openPositionsRepository = { findDistinctUserIdsWithUnbilled: jest.fn() };
  const usersRepository = { findById: jest.fn() };
  const enqueuePort = { enqueueCoordinator: jest.fn() };
  const createService = (withQueue = true) =>
    new AdminBillNowService(
      openPositionsRepository as never,
      usersRepository as never,
      withQueue ? enqueuePort : undefined,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    openPositionsRepository.findDistinctUserIdsWithUnbilled.mockResolvedValue(['user-1', 'user-2']);
    enqueuePort.enqueueCoordinator.mockResolvedValue(undefined);
  });

  it('queueBillNow enqueues coordinator for all users with unbilled positions', async () => {
    const service = createService();
    const result = await service.queueBillNow('admin-1', {});

    expect(result.queued).toBe(true);
    expect(result.userCount).toBe(2);
    expect(result.requestId).toEqual(expect.any(String));
    expect(enqueuePort.enqueueCoordinator).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        scope: 'all',
        requestId: result.requestId,
      }),
    );
  });

  it('queueBillNow enqueues coordinator for a single user', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'user-1' });
    const service = createService();
    const result = await service.queueBillNow('admin-1', { userId: 'user-1' });

    expect(result.userCount).toBe(1);
    expect(enqueuePort.enqueueCoordinator).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        scope: 'user',
        userId: 'user-1',
      }),
    );
  });

  it('queueBillNow rejects unknown user before enqueue', async () => {
    usersRepository.findById.mockResolvedValue(null);
    const service = createService();

    await expect(service.queueBillNow('admin-1', { userId: 'missing' })).rejects.toThrow(BadRequestException);
    expect(enqueuePort.enqueueCoordinator).not.toHaveBeenCalled();
  });

  it('queueBillNow fails when queue is not configured', async () => {
    const service = createService(false);

    await expect(service.queueBillNow('admin-1', {})).rejects.toThrow(InternalServerErrorException);
  });
});
