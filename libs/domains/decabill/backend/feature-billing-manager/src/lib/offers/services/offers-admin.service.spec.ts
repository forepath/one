import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';

import { OffersAdminService } from './offers-admin.service';

describe('OffersAdminService', () => {
  const offersRepository = {
    findAllForAdmin: jest.fn(),
    findByIdOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const offerLineItemsRepository = {
    deleteByOfferId: jest.fn(),
    createMany: jest.fn(),
    findByOfferId: jest.fn(),
  };
  const usersRepository = {
    findByIdForTenant: jest.fn(),
  };
  const taxCalculationService = {
    computeLines: jest.fn().mockReturnValue({
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      resolvedTaxRate: 19,
      lines: [
        {
          description: 'Consulting',
          quantity: 1,
          unitPriceNet: 100,
          taxCategory: 'standard',
          taxRate: 19,
          lineNet: 100,
          lineTax: 19,
          lineGross: 119,
        },
      ],
    }),
  };
  const invoiceTaxContextService = {
    resolveForUser: jest.fn().mockResolvedValue({
      treatment: {
        taxMode: 'domestic_vat',
        taxCountryCode: 'DE',
        invoiceNote: null,
        einvoiceTaxCategoryCode: 'S',
        issuerIsInEu: true,
        chargeVat: true,
      },
      forceChargeNonEuIssuerEuB2b: false,
      buyerVatId: null,
      buyerCountry: 'DE',
      buyerCustomerType: 'consumer',
      issuerCountry: 'DE',
    }),
  };
  const auditLog = { log: jest.fn() };
  const subscriptionOrderPreparationService = {
    prepareForUser: jest.fn(),
  };
  const offerArchiveService = { archive: jest.fn() };
  const offerPdfService = { readPdf: jest.fn() };
  const billingNotificationPublisher = { publishOffer: jest.fn() };
  const billingSearchIndexService = { scheduleUpsert: jest.fn() };

  const service = new OffersAdminService(
    offersRepository as never,
    offerLineItemsRepository as never,
    usersRepository as never,
    taxCalculationService as never,
    invoiceTaxContextService as never,
    auditLog as never,
    subscriptionOrderPreparationService as never,
    offerArchiveService as never,
    offerPdfService as never,
    billingNotificationPublisher as never,
    billingSearchIndexService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    usersRepository.findByIdForTenant.mockResolvedValue({ id: 'user-1', email: 'user@example.com' });
    offersRepository.create.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.DRAFT,
      currency: 'EUR',
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      billToOpenPositions: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    offersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'offer-1',
      userId: 'user-1',
      status: OfferStatus.DRAFT,
      currency: 'EUR',
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      billToOpenPositions: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lineItems: [
        {
          id: 'line-1',
          position: 0,
          lineType: OfferLineType.STANDARD,
          description: 'Consulting',
          quantity: 1,
          unitLabel: null,
          unitPriceNet: 100,
          taxCategory: 'standard',
          taxRate: 19,
          lineNet: 100,
          lineTax: 19,
          lineGross: 119,
          fulfillmentStatus: 'pending',
        },
      ],
    });
  });

  it('creates a draft offer with a standard line', async () => {
    const result = await service.create(
      {
        userId: 'user-1',
        currency: 'EUR',
        lineItems: [
          {
            lineType: OfferLineType.STANDARD,
            payload: {
              description: 'Consulting',
              quantity: 1,
              unitPriceNet: 100,
            },
          },
        ],
      },
      'admin-1',
    );

    expect(offersRepository.create).toHaveBeenCalled();
    expect(offerLineItemsRepository.createMany).toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.create',
        userId: 'user-1',
      }),
    );
    expect(result.id).toBe('offer-1');
    expect(result.lineItems).toHaveLength(1);
  });
});
