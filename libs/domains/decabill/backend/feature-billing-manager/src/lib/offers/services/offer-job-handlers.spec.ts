describe('OfferExpirationJobHandler', () => {
  const offersRepository = {
    findArchivedExpired: jest.fn(),
  };
  const offersAdminService = {
    expireOffer: jest.fn(),
  };

  let handler: import('./offer-expiration.job-handler').OfferExpirationJobHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    const { OfferExpirationJobHandler } = await import('./offer-expiration.job-handler');

    handler = new OfferExpirationJobHandler(offersRepository as never, offersAdminService as never);
  });

  it('returns expired offer ids', async () => {
    offersRepository.findArchivedExpired.mockResolvedValue([{ id: 'offer-1' }, { id: 'offer-2' }]);

    await expect(handler.findExpiredOfferIds()).resolves.toEqual(['offer-1', 'offer-2']);
  });

  it('delegates expiration to admin service', async () => {
    await handler.expireOffer('offer-1');

    expect(offersAdminService.expireOffer).toHaveBeenCalledWith('offer-1');
  });
});

describe('OfferFulfillmentJobHandler', () => {
  const offerLineItemsRepository = {
    findDueScheduledLines: jest.fn(),
  };
  const offerFulfillmentService = {
    fulfillLine: jest.fn(),
  };

  let handler: import('./offer-fulfillment.job-handler').OfferFulfillmentJobHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    const { OfferFulfillmentJobHandler } = await import('./offer-fulfillment.job-handler');

    handler = new OfferFulfillmentJobHandler(offerLineItemsRepository as never, offerFulfillmentService as never);
  });

  it('maps due scheduled lines to job payloads', async () => {
    offerLineItemsRepository.findDueScheduledLines.mockResolvedValue([
      { id: 'line-1', offerId: 'offer-1' },
      { id: 'line-2', offerId: 'offer-2' },
    ]);

    await expect(handler.findDueLineIds()).resolves.toEqual([
      { offerId: 'offer-1', lineItemId: 'line-1' },
      { offerId: 'offer-2', lineItemId: 'line-2' },
    ]);
  });

  it('delegates line fulfillment to service', async () => {
    await handler.processLine('offer-1', 'line-1');

    expect(offerFulfillmentService.fulfillLine).toHaveBeenCalledWith('offer-1', 'line-1');
  });
});

describe('OfferStatisticsQueryService', () => {
  const offersRepository = {
    countByStatus: jest.fn(),
    sumGrossByStatus: jest.fn(),
    countByTimestampField: jest.fn(),
    countTransitionSeries: jest.fn(),
  };

  let service: import('./offer-statistics-query.service').OfferStatisticsQueryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    offersRepository.countByStatus.mockResolvedValue(1);
    offersRepository.sumGrossByStatus.mockResolvedValue(100);
    offersRepository.countByTimestampField.mockResolvedValue(2);
    offersRepository.countTransitionSeries.mockResolvedValue([{ period: '2026-01-01', count: 3 }]);

    const { OfferStatisticsQueryService } = await import('./offer-statistics-query.service');

    service = new OfferStatisticsQueryService(offersRepository as never);
  });

  it('aggregates offer statistics for a date range', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');

    const result = await service.getStatistics({ from, to, groupBy: 'day' });

    expect(result.draftCount).toBe(1);
    expect(result.pendingCount).toBe(1);
    expect(result.pendingGross).toBe(100);
    expect(result.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          period: '2026-01-01',
          archivedCount: 3,
          acceptedCount: 3,
          declinedCount: 3,
        }),
      ]),
    );
  });
});
