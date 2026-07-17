import { WebhookDeliveryRetentionService } from './webhook-delivery-retention.service';

describe('WebhookDeliveryRetentionService', () => {
  const deliveriesRepository = {
    deleteOlderThan: jest.fn(),
    countByEndpointId: jest.fn(),
    deleteOldestExcess: jest.fn(),
  };

  const endpointsRepository = {
    findAllBatch: jest.fn(),
  };

  let service: WebhookDeliveryRetentionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookDeliveryRetentionService(deliveriesRepository as never, endpointsRepository as never);
  });

  it('prunes by age then by count for a single endpoint', async () => {
    deliveriesRepository.deleteOlderThan.mockResolvedValue(3);
    deliveriesRepository.countByEndpointId.mockResolvedValue(600);
    deliveriesRepository.deleteOldestExcess.mockResolvedValue(100);

    const result = await service.applyRetentionForEndpoint({
      id: 'endpoint-1',
      deliveryLogRetentionDays: 14,
      deliveryLogMaxEntries: 500,
    });

    expect(deliveriesRepository.deleteOlderThan).toHaveBeenCalledWith('endpoint-1', expect.any(Date));
    expect(deliveriesRepository.countByEndpointId).toHaveBeenCalledWith('endpoint-1');
    expect(deliveriesRepository.deleteOldestExcess).toHaveBeenCalledWith('endpoint-1', 500);
    expect(result).toEqual({ deletedByAge: 3, deletedByCount: 100 });
  });

  it('skips count pruning when remaining entries are within limit', async () => {
    deliveriesRepository.deleteOlderThan.mockResolvedValue(0);
    deliveriesRepository.countByEndpointId.mockResolvedValue(120);

    const result = await service.applyRetentionForEndpoint({
      id: 'endpoint-2',
      deliveryLogRetentionDays: null,
      deliveryLogMaxEntries: null,
    });

    expect(deliveriesRepository.deleteOldestExcess).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedByAge: 0, deletedByCount: 0 });
  });

  it('processes all endpoints in batches', async () => {
    endpointsRepository.findAllBatch
      .mockResolvedValueOnce([{ id: 'endpoint-1', deliveryLogRetentionDays: 7, deliveryLogMaxEntries: 50 }])
      .mockResolvedValueOnce([]);
    deliveriesRepository.deleteOlderThan.mockResolvedValue(1);
    deliveriesRepository.countByEndpointId.mockResolvedValue(50);

    const result = await service.applyRetentionForAllEndpoints(100);

    expect(endpointsRepository.findAllBatch).toHaveBeenCalledWith(0, 100);
    expect(result).toEqual({ endpointsProcessed: 1, deletedByAge: 1, deletedByCount: 0 });
  });

  it('logs retention failures without throwing from fire-and-forget helper', async () => {
    deliveriesRepository.deleteOlderThan.mockRejectedValue(new Error('database unavailable'));

    expect(() =>
      service.applyRetentionForEndpointFireAndForget({
        id: 'endpoint-3',
        deliveryLogRetentionDays: 30,
        deliveryLogMaxEntries: 500,
      }),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
