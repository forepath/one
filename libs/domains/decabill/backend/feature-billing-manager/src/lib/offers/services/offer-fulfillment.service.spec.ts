import { ProjectPricingModel } from '../../projects/entities/project.enums';
import { OfferFulfillmentStatus } from '../constants/offer-fulfillment-status.constants';
import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';

import { OfferFulfillmentService } from './offer-fulfillment.service';

describe('OfferFulfillmentService project lines', () => {
  const offersRepository = { findByIdOrThrow: jest.fn(), update: jest.fn() };
  const offerLineItemsRepository = { findByOfferId: jest.fn(), findByIdOrThrow: jest.fn(), update: jest.fn() };
  const projectsAdminService = { create: jest.fn() };
  const billingNotificationPublisher = {
    publishOfferLineFulfilled: jest.fn(),
    publishOfferLineFulfillmentFailed: jest.fn(),
  };
  const auditLog = { log: jest.fn() };
  let service: OfferFulfillmentService;
  const offer = { id: 'o1', userId: 'u1', currency: 'EUR', status: OfferStatus.ACCEPTED };
  const projectLine = (payload: Record<string, unknown>) => ({
    id: 'l1',
    offerId: 'o1',
    lineType: OfferLineType.PROJECT_TEMPLATE,
    description: 'Website',
    unitPriceNet: 100,
    fulfillmentStatus: OfferFulfillmentStatus.PENDING,
    projectTemplatePayload: payload,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    offersRepository.findByIdOrThrow.mockResolvedValue(offer);
    projectsAdminService.create.mockResolvedValue({ id: 'p1' });
    service = new OfferFulfillmentService(
      offersRepository as never,
      offerLineItemsRepository as never,
      {} as never,
      {} as never,
      projectsAdminService as never,
      {} as never,
      {} as never,
      {} as never,
      billingNotificationPublisher as never,
      auditLog as never,
    );
  });

  it('creates the project with the offered maximum / fixed price', async () => {
    offerLineItemsRepository.findByIdOrThrow.mockResolvedValue(
      projectLine({ name: 'Site', hourlyRateNet: 120, pricingModel: 'fixed', priceLimitNet: 9000, targetHours: 80 }),
    );

    await service.fulfillLine('o1', 'l1');

    expect(projectsAdminService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        name: 'Site',
        hourlyRateNet: 120,
        targetHours: 80,
        pricingModel: ProjectPricingModel.FIXED,
        priceLimitNet: 9000,
      }),
    );
    expect(offerLineItemsRepository.update).toHaveBeenCalledWith(
      'l1',
      expect.objectContaining({ fulfillmentStatus: OfferFulfillmentStatus.COMPLETED, resultProjectId: 'p1' }),
    );
  });

  it('keeps legacy and unknown payloads hourly', async () => {
    offerLineItemsRepository.findByIdOrThrow.mockResolvedValue(
      projectLine({ name: 'Site', hourlyRateNet: 120, pricingModel: 'weekly' }),
    );

    await service.fulfillLine('o1', 'l1');

    expect(projectsAdminService.create).toHaveBeenCalledWith(
      expect.objectContaining({ pricingModel: ProjectPricingModel.HOURLY, priceLimitNet: null }),
    );
  });
});
