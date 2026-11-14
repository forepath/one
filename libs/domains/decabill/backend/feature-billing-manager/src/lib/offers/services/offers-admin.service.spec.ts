import { BadRequestException } from '@nestjs/common';

import { DeliveryTermsCode } from '../../constants/document-terms.constants';
import { BillingDocumentTermsConfigService } from '../../services/billing-document-terms-config.service';
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
  const offerArchiveService = { archive: jest.fn(), getPdfBuffer: jest.fn() };
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
    billingNotificationPublisher as never,
    billingSearchIndexService as never,
    new BillingDocumentTermsConfigService(),
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
    expect(result).toEqual(expect.objectContaining({ canPreview: false, canDownload: false }));
  });

  it('stores normalized payment / delivery terms on the draft and returns stored + effective terms', async () => {
    const result = await service.create(
      {
        userId: 'user-1',
        paymentDueDays: 30,
        deliveryTermsCode: DeliveryTermsCode.DAP,
        deliveryTermsPlace: '  Berlin  ',
        deliveryTermsText: 'dropped for Incoterms',
        lineItems: [
          { lineType: OfferLineType.STANDARD, payload: { description: 'Consulting', quantity: 1, unitPriceNet: 100 } },
        ],
      },
      'admin-1',
    );

    expect(offersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDueDays: 30,
        deliveryTermsCode: DeliveryTermsCode.DAP,
        deliveryTermsPlace: 'Berlin',
        deliveryTermsText: null,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        paymentDueDays: null,
        deliveryTermsCode: null,
        effectiveDocumentTerms: {
          paymentDueDays: 14,
          deliveryTermsCode: null,
          deliveryTermsPlace: null,
          deliveryTermsText: null,
        },
      }),
    );
  });

  it('rejects custom delivery terms without text', async () => {
    await expect(
      service.create({
        userId: 'user-1',
        deliveryTermsCode: DeliveryTermsCode.CUSTOM,
        lineItems: [
          { lineType: OfferLineType.STANDARD, payload: { description: 'Consulting', quantity: 1, unitPriceNet: 100 } },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(offersRepository.create).not.toHaveBeenCalled();
  });

  it('serves the stored PDF of a sent offer and flags it previewable / downloadable', async () => {
    const sent = {
      id: 'offer-1',
      userId: 'user-1',
      offerNumber: 'OFF-1',
      status: OfferStatus.ARCHIVED,
      pdfStorageKey: 'user-1/offer-1.pdf',
      currency: 'EUR',
      subtotalNet: 100,
      taxTotal: 19,
      totalGross: 119,
      billToOpenPositions: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lineItems: [],
    };

    offersRepository.findByIdOrThrow.mockResolvedValue(sent);
    offerArchiveService.getPdfBuffer.mockResolvedValue(Buffer.from('%PDF'));

    await expect(service.readPdf('offer-1')).resolves.toEqual({ buffer: Buffer.from('%PDF'), filename: 'OFF-1.pdf' });
    expect(offerArchiveService.getPdfBuffer).toHaveBeenCalledWith(sent);
    await expect(service.get('offer-1')).resolves.toEqual(
      expect.objectContaining({ canPreview: true, canDownload: true }),
    );
  });
});
