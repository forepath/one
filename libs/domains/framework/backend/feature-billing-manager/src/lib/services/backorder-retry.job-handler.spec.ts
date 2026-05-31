import { BackorderRetryJobHandler } from './backorder-retry.job-handler';

describe('BackorderRetryJobHandler', () => {
  const backordersRepository = {
    findAllPending: jest.fn(),
  } as any;
  const backorderService = {
    retry: jest.fn(),
  } as any;
  const handler = new BackorderRetryJobHandler(backordersRepository, backorderService);

  it('findPendingBackorderIds maps repository rows', async () => {
    backordersRepository.findAllPending.mockResolvedValue([{ id: 'bo-1' }]);

    await expect(handler.findPendingBackorderIds()).resolves.toEqual(['bo-1']);
  });

  it('retryBackorder delegates to service', async () => {
    backorderService.retry.mockResolvedValue(undefined);

    await handler.retryBackorder('bo-1');

    expect(backorderService.retry).toHaveBeenCalledWith('bo-1');
  });
});
