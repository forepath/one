import { SearchReindexJobHandler } from './search-reindex.job-handler';

describe('SearchReindexJobHandler', () => {
  const billingSearchIndexService = {
    upsert: jest.fn(),
    delete: jest.fn(),
    reindexBatch: jest.fn(),
  };
  const billingNotificationPublisher = { publish: jest.fn() };
  const handler = new SearchReindexJobHandler(
    billingSearchIndexService as never,
    billingNotificationPublisher as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes search.document.sync_failed and rethrows when an index sync fails', async () => {
    billingSearchIndexService.delete.mockRejectedValue(new Error('cluster unavailable'));

    await expect(
      handler.processSyncUnit({ tenantId: 'tenant-a', entityType: 'invoices', id: 'inv-1', action: 'delete' } as never),
    ).rejects.toThrow('cluster unavailable');

    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'search.document.sync_failed',
      expect.objectContaining({
        tenantId: 'tenant-a',
        entityType: 'invoices',
        id: 'inv-1',
        action: 'delete',
        error: 'cluster unavailable',
        failedAt: expect.any(String),
      }),
    );
  });

  it('does not publish on successful sync', async () => {
    billingSearchIndexService.upsert.mockResolvedValue(undefined);

    await handler.processSyncUnit({
      tenantId: 'tenant-a',
      entityType: 'invoices',
      id: 'inv-1',
      action: 'upsert',
      document: { id: 'inv-1' },
    } as never);

    expect(billingNotificationPublisher.publish).not.toHaveBeenCalled();
  });

  it('aligns reindex failure payload with the shared search event shape', () => {
    handler.publishReindexFailed('tenant-a', 'boom');

    expect(billingNotificationPublisher.publish).toHaveBeenCalledWith(
      'search.reindex.failed',
      expect.objectContaining({ tenantId: 'tenant-a', message: 'boom', error: 'boom', failedAt: expect.any(String) }),
    );
  });
});
