import { BillingMeterRealtimeService } from './billing-meter-realtime.service';

describe('BillingMeterRealtimeService', () => {
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const meterBillingService = {
    buildSubscriptionMeterSummaries: jest.fn(),
  };
  let service: BillingMeterRealtimeService;
  let mockServer: { to: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BillingMeterRealtimeService(subscriptionsRepository as never, meterBillingService as never);
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    service.attachServer(mockServer as never);
  });

  it('uses subscription-scoped room names', () => {
    expect(BillingMeterRealtimeService.subscriptionRoom('sub-1')).toBe('subscription:sub-1');
  });

  it('emits meterSummaryUpdate to the subscription room', async () => {
    const subscription = {
      id: 'sub-1',
      currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
    };

    subscriptionsRepository.findByIdOrThrow.mockResolvedValue(subscription);
    meterBillingService.buildSubscriptionMeterSummaries.mockResolvedValue([
      {
        meterId: 'meter-1',
        key: 'bandwidth',
        name: 'Bandwidth',
        aggregator: 'sum',
        attachmentType: 'plan',
        effectiveUnitPriceNet: 0.01,
        effectiveIncludedUsage: 0,
        aggregatedValue: 42,
        billableValue: 42,
        estimatedChargeNet: 0.42,
        entryCount: 1,
      },
    ]);

    await service.emitMeterSummaryUpdate('sub-1');

    expect(mockServer.to).toHaveBeenCalledWith(['subscription:sub-1', 'subscription:sub-1#event:meterSummaryUpdate']);
    const emit = mockServer.to.mock.results[0].value.emit as jest.Mock;

    expect(emit).toHaveBeenCalledWith(
      'meterSummaryUpdate',
      expect.objectContaining({
        subscriptionId: 'sub-1',
        meters: expect.arrayContaining([
          expect.objectContaining({
            meterId: 'meter-1',
            effectiveIncludedUsage: 0,
            billableValue: 42,
            aggregatedValue: 42,
            estimatedChargeNet: 0.42,
          }),
        ]),
      }),
    );
  });

  it('skips emit when the subscription cannot be loaded', async () => {
    subscriptionsRepository.findByIdOrThrow.mockRejectedValue(new Error('missing'));

    await service.emitMeterSummaryUpdate('sub-missing');

    expect(mockServer.to).not.toHaveBeenCalled();
  });
});
