import { PaymentWebhookEventsRepository } from './payment-webhook-events.repository';

describe('PaymentWebhookEventsRepository', () => {
  let mockRepository: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockRepository = {
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
  });

  it('exists returns true when event count is positive', async () => {
    mockRepository.count.mockResolvedValue(1);

    const repository = new PaymentWebhookEventsRepository(mockRepository as never);

    await expect(repository.exists('stripe', 'evt_1')).resolves.toBe(true);
    expect(mockRepository.count).toHaveBeenCalledWith({ where: { processor: 'stripe', eventId: 'evt_1' } });
  });

  it('create persists webhook event', async () => {
    const dto = { processor: 'stripe', eventId: 'evt_1', payloadHash: 'abc', result: 'processed' };
    const created = { id: 'wh-1', ...dto };

    mockRepository.create.mockReturnValue(created);
    mockRepository.save.mockResolvedValue(created);

    const repository = new PaymentWebhookEventsRepository(mockRepository as never);
    const result = await repository.create(dto);

    expect(result).toEqual(created);
  });
});
