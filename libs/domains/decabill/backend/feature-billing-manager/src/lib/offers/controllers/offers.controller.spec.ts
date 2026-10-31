import { BadRequestException } from '@nestjs/common';

import { OffersController } from './offers.controller';

describe('OffersController (customer lists)', () => {
  const service = { listPending: jest.fn(), listHistory: jest.fn() };
  const controller = new OffersController(service as never);
  const req = { user: { id: 'user-1', roles: [] } } as never;

  beforeEach(() => {
    jest.resetAllMocks();
    service.listPending.mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 });
    service.listHistory.mockResolvedValue({ items: [{ id: 'o-1' }], total: 31, limit: 25, offset: 25 });
  });

  it('pages the pending offers of the caller only (defaults 10 / 0)', async () => {
    await controller.listPending(req, 'acme');

    expect(service.listPending).toHaveBeenCalledWith('user-1', 10, 0, 'acme');
  });

  it('pages the offer history with limit / offset and returns the total', async () => {
    const result = await controller.listHistory(req, undefined, 25, 25);

    expect(service.listHistory).toHaveBeenCalledWith('user-1', 25, 25, undefined);
    expect(result.total).toBe(31);
  });

  it('caps the page size at 100 and clamps negative offsets', async () => {
    await controller.listPending(req, undefined, 5000, -3);

    expect(service.listPending).toHaveBeenCalledWith('user-1', 100, 0, undefined);
  });

  it('rejects unauthenticated callers', async () => {
    await expect(controller.listHistory({} as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.listHistory).not.toHaveBeenCalled();
  });
});
