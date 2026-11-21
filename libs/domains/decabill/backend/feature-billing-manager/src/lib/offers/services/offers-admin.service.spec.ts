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
    { findByIds: jest.fn().mockResolvedValue([]) } as never,
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

  it('stores the normalized document note on the draft and returns it', async () => {
    const result = await service.create(
      {
        userId: 'user-1',
        note: '  Valid for 30 days\u0000 ',
        lineItems: [
          { lineType: OfferLineType.STANDARD, payload: { description: 'Consulting', quantity: 1, unitPriceNet: 100 } },
        ],
      },
      'admin-1',
    );

    expect(offersRepository.create).toHaveBeenCalledWith(expect.objectContaining({ note: 'Valid for 30 days' }));
    expect(result.note).toBeNull();
  });

  it('clears the note when the draft is saved without one', async () => {
    await service.create(
      {
        userId: 'user-1',
        note: '   ',
        lineItems: [
          { lineType: OfferLineType.STANDARD, payload: { description: 'Consulting', quantity: 1, unitPriceNet: 100 } },
        ],
      },
      'admin-1',
    );

    expect(offersRepository.create).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
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

describe('OffersAdminService revoke / expiry notifications', () => {
  let stored: Record<string, unknown>;
  const offersRepository = {
    findByIdOrThrow: jest.fn(async () => stored),
    update: jest.fn(async (_id: string, patch: Record<string, unknown>) => {
      stored = { ...stored, ...patch };

      return stored;
    }),
  };
  const billingEmailPublisher = { publishOfferRevoked: jest.fn(), publishOfferExpired: jest.fn() };
  const auditLog = { log: jest.fn() };
  const offerArchiveService = { archive: jest.fn(), send: jest.fn() };
  const offerResponseService = { accept: jest.fn(), decline: jest.fn() };
  const service = new OffersAdminService(
    offersRepository as never,
    { findByOfferId: jest.fn().mockResolvedValue([]) } as never,
    { findByIdForTenant: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com' }) } as never,
    {} as never,
    {} as never,
    auditLog as never,
    {} as never,
    offerArchiveService as never,
    { publishOffer: jest.fn() } as never,
    { scheduleUpsert: jest.fn() } as never,
    new BillingDocumentTermsConfigService(),
    { findByIds: jest.fn().mockResolvedValue([]) } as never,
    undefined,
    billingEmailPublisher as never,
    offerResponseService as never,
  );
  const offer = (patch: Record<string, unknown> = {}) => ({
    id: 'offer-1',
    userId: 'user-1',
    offerNumber: 'OFF-2026-00001',
    status: OfferStatus.ARCHIVED,
    currency: 'EUR',
    totalGross: 119,
    subtotalNet: 100,
    taxTotal: 19,
    billToOpenPositions: false,
    sentAt: new Date('2026-01-01T00:00:00Z'),
    notifyOnExpiry: true,
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lineItems: [],
    ...patch,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    billingEmailPublisher.publishOfferRevoked.mockResolvedValue(true);
    billingEmailPublisher.publishOfferExpired.mockResolvedValue(true);
  });

  it('emails the customer when a sent offer is revoked (default)', async () => {
    stored = offer();

    await service.revoke('offer-1', 'admin-1');

    expect(billingEmailPublisher.publishOfferRevoked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'offer-1', status: OfferStatus.REVOKED }),
    );
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.revoke',
        context: expect.objectContaining({ customerNotified: true }),
      }),
    );
  });

  it('suppresses the revoke email when notifyCustomer is false', async () => {
    stored = offer();

    await service.revoke('offer-1', 'admin-1', { notifyCustomer: false });

    expect(billingEmailPublisher.publishOfferRevoked).not.toHaveBeenCalled();
  });

  it('emails about revoking an archived offer that was not emailed yet when asked (like a void)', async () => {
    stored = offer({ sentAt: null, expiresAt: null });

    await service.revoke('offer-1', 'admin-1', { notifyCustomer: true });

    expect(billingEmailPublisher.publishOfferRevoked).toHaveBeenCalledTimes(1);
  });

  it('never emails about revoking a draft', async () => {
    stored = offer({ status: OfferStatus.DRAFT, sentAt: null });

    await service.revoke('offer-1', 'admin-1', { notifyCustomer: true });

    expect(billingEmailPublisher.publishOfferRevoked).not.toHaveBeenCalled();
  });

  it('emails the customer when a sent offer expires and the expiry email was chosen', async () => {
    stored = offer();

    await service.expireOffer('offer-1');

    expect(offersRepository.update).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({ status: OfferStatus.EXPIRED }),
    );
    expect(billingEmailPublisher.publishOfferExpired).toHaveBeenCalledTimes(1);
  });

  it('does not email on expiry when the expiry email was not chosen', async () => {
    stored = offer({ notifyOnExpiry: false });

    await service.expireOffer('offer-1');

    expect(billingEmailPublisher.publishOfferExpired).not.toHaveBeenCalled();
  });

  it('emails on expiry for an offer that was not emailed yet when the expiry email was chosen', async () => {
    stored = offer({ sentAt: null, notifyOnExpiry: true });

    await service.expireOffer('offer-1');

    expect(billingEmailPublisher.publishOfferExpired).toHaveBeenCalledTimes(1);
  });

  it('does not expire (or email about) offers that are no longer archived', async () => {
    stored = offer({ status: OfferStatus.ACCEPTED });

    await service.expireOffer('offer-1');

    expect(offersRepository.update).not.toHaveBeenCalled();
    expect(billingEmailPublisher.publishOfferExpired).not.toHaveBeenCalled();
  });

  it('passes the archive options through and delegates send', async () => {
    await service.archive('offer-1', 'admin-1', { notifyCustomer: false, notifyOnExpiry: false });
    await service.send('offer-1', 'admin-1');

    expect(offerArchiveService.archive).toHaveBeenCalledWith('offer-1', 'admin-1', {
      notifyCustomer: false,
      notifyOnExpiry: false,
    });
    expect(offerArchiveService.send).toHaveBeenCalledWith('offer-1', 'admin-1');
  });

  it('records accept / decline through the shared response service as the admin (tenant-scoped lookup first)', async () => {
    stored = offer({ sentAt: null, expiresAt: null });

    const accepted = await service.accept('offer-1', 'admin-1', { notifyCustomer: false, notifyInvoices: true });

    expect(offersRepository.findByIdOrThrow).toHaveBeenCalledWith('offer-1');
    expect(offerResponseService.accept).toHaveBeenCalledWith(
      stored,
      { kind: 'admin', adminUserId: 'admin-1' },
      { notifyCustomer: false, notifyInvoices: true },
    );
    expect(accepted).toEqual(expect.objectContaining({ id: 'offer-1', canAccept: true, canDecline: true }));

    await service.decline('offer-1', 'admin-1');

    expect(offerResponseService.decline).toHaveBeenCalledWith(
      stored,
      { kind: 'admin', adminUserId: 'admin-1' },
      { notifyCustomer: undefined },
    );
  });

  it('flags accept / decline exactly where the customer could answer', async () => {
    const flags = async (patch: Record<string, unknown>) => {
      stored = offer(patch);
      const { canAccept, canDecline } = await service.get('offer-1');

      return { canAccept, canDecline };
    };

    expect(await flags({ expiresAt: null })).toEqual({ canAccept: true, canDecline: true });
    expect(await flags({ expiresAt: new Date('2000-01-01T00:00:00Z') })).toEqual({
      canAccept: false,
      canDecline: true,
    });

    for (const status of [OfferStatus.DRAFT, OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.REVOKED]) {
      expect(await flags({ status, expiresAt: null })).toEqual({ canAccept: false, canDecline: false });
    }
  });
});
