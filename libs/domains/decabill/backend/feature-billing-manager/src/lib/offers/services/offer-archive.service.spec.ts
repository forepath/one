import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DeliveryTermsCode } from '../../constants/document-terms.constants';
import { BillingDocumentTermsConfigService } from '../../services/billing-document-terms-config.service';
import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';

import { OfferArchiveService } from './offer-archive.service';

describe('OfferArchiveService.getPdfBuffer', () => {
  const offersRepository = { update: jest.fn() };
  const offerLineItemsRepository = { findByOfferId: jest.fn() };
  const customerProfilesService = { getByUserId: jest.fn() };
  const billingIssuerConfig = { assertConfigured: jest.fn(), getConfig: jest.fn(() => ({ name: 'Issuer' })) };
  const offerPdfService = { readPdf: jest.fn(), generateAndStore: jest.fn() };
  const service = new OfferArchiveService(
    offersRepository as never,
    offerLineItemsRepository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    customerProfilesService as never,
    billingIssuerConfig as never,
    offerPdfService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    new BillingDocumentTermsConfigService(),
  );
  const sent = (pdfStorageKey: string | null): OfferEntity =>
    ({ id: 'offer-1', userId: 'user-1', status: OfferStatus.ARCHIVED, pdfStorageKey }) as OfferEntity;
  const pdf = Buffer.from('%PDF');

  beforeEach(() => {
    jest.clearAllMocks();
    customerProfilesService.getByUserId.mockResolvedValue({ userId: 'user-1' });
    offerLineItemsRepository.findByOfferId.mockResolvedValue([{ id: 'line-1' }]);
    offerPdfService.generateAndStore.mockResolvedValue('user-1/offer-1.pdf');
  });

  it('serves the stored file without rendering', async () => {
    offerPdfService.readPdf.mockResolvedValue(pdf);

    await expect(service.getPdfBuffer(sent('user-1/offer-1.pdf'))).resolves.toBe(pdf);
    expect(offerPdfService.generateAndStore).not.toHaveBeenCalled();
  });

  it('renders and stores the PDF of a sent offer that has none (e.g. data created outside the send flow)', async () => {
    offerPdfService.readPdf.mockResolvedValue(pdf);

    await expect(service.getPdfBuffer(sent(null))).resolves.toBe(pdf);
    expect(offerPdfService.generateAndStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'offer-1' }),
      [{ id: 'line-1' }],
      { name: 'Issuer' },
      { userId: 'user-1' },
    );
    expect(offersRepository.update).toHaveBeenCalledWith('offer-1', { pdfStorageKey: 'user-1/offer-1.pdf' });
    expect(offerPdfService.readPdf).toHaveBeenCalledWith('user-1/offer-1.pdf');
  });

  it('re-renders when the stored file is missing or unreadable', async () => {
    offerPdfService.readPdf.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(pdf);

    await expect(service.getPdfBuffer(sent('user-1/gone.pdf'))).resolves.toBe(pdf);
    expect(offerPdfService.generateAndStore).toHaveBeenCalledTimes(1);
  });

  it('never renders a draft, and needs the customer profile to render', async () => {
    await expect(
      service.getPdfBuffer({ ...sent('user-1/offer-1.pdf'), status: OfferStatus.DRAFT } as OfferEntity),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(offerPdfService.readPdf).not.toHaveBeenCalled();

    customerProfilesService.getByUserId.mockResolvedValue(null);
    await expect(service.getPdfBuffer(sent(null))).rejects.toBeInstanceOf(NotFoundException);
    expect(offerPdfService.generateAndStore).not.toHaveBeenCalled();
  });
});

describe('OfferArchiveService.archive', () => {
  const draft = {
    id: 'offer-1',
    userId: 'user-1',
    status: OfferStatus.DRAFT,
    currency: 'EUR',
    paymentDueDays: null,
    deliveryTermsCode: DeliveryTermsCode.FCA,
    deliveryTermsPlace: 'Hamburg',
    deliveryTermsText: null,
    lineItems: [
      {
        id: 'line-1',
        lineType: OfferLineType.STANDARD,
        description: 'Consulting',
        quantity: 1,
        unitPriceNet: 100,
        taxCategory: 'standard',
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as OfferEntity;
  const offersRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(async (_id: string, patch: Partial<OfferEntity>) => ({ ...draft, ...patch })),
  };
  const offerLineItemsRepository = { findByOfferId: jest.fn(), update: jest.fn() };
  const documentTermsConfig = new BillingDocumentTermsConfigService();
  const service = new OfferArchiveService(
    offersRepository as never,
    offerLineItemsRepository as never,
    { nextOfferNumber: jest.fn().mockResolvedValue({ number: 'OFF-2026-00001', numberScope: 'shared' }) } as never,
    { findByIdForTenant: jest.fn().mockResolvedValue({ email: 'user@example.com' }) } as never,
    { prepareForUser: jest.fn() } as never,
    {
      computeLines: jest.fn().mockReturnValue({
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
        subtotalNet: 100,
        taxTotal: 19,
        totalGross: 119,
        resolvedTaxRate: 19,
      }),
    } as never,
    {
      resolveForUser: jest.fn().mockResolvedValue({
        treatment: { taxMode: 'domestic_vat', taxCountryCode: 'DE', einvoiceTaxCategoryCode: 'S', issuerIsInEu: true },
        forceChargeNonEuIssuerEuB2b: false,
      }),
    } as never,
    {
      getByUserId: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      isProfileComplete: jest.fn().mockReturnValue(true),
    } as never,
    { assertConfigured: jest.fn(), getConfig: jest.fn(() => ({ name: 'Issuer' })) } as never,
    { generateAndStore: jest.fn().mockResolvedValue('user-1/offer-1.pdf') } as never,
    { publishOfferArchived: jest.fn() } as never,
    { publishOffer: jest.fn() } as never,
    { scheduleUpsert: jest.fn() } as never,
    { log: jest.fn() } as never,
    documentTermsConfig,
  );

  afterEach(() => {
    delete process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS;
  });

  it('freezes the offer terms (global default for unset facets) before rendering the PDF', async () => {
    process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS = '10';
    documentTermsConfig.onModuleInit();
    offersRepository.findByIdOrThrow.mockResolvedValue(draft);
    offerLineItemsRepository.findByOfferId.mockResolvedValue(draft.lineItems);

    const result = await service.archive('offer-1', 'admin-1');

    expect(offersRepository.update).toHaveBeenNthCalledWith(
      1,
      'offer-1',
      expect.objectContaining({
        status: OfferStatus.ARCHIVED,
        paymentDueDays: 10,
        deliveryTermsCode: DeliveryTermsCode.FCA,
        deliveryTermsPlace: 'Hamburg',
        deliveryTermsText: null,
      }),
    );
    expect(result.effectiveDocumentTerms).toEqual(
      expect.objectContaining({ paymentDueDays: 10, deliveryTermsCode: DeliveryTermsCode.FCA }),
    );
  });
});

describe('OfferArchiveService finalize and send', () => {
  const draft = {
    id: 'offer-1',
    userId: 'user-1',
    status: OfferStatus.DRAFT,
    currency: 'EUR',
    lineItems: [
      {
        id: 'line-1',
        lineType: OfferLineType.STANDARD,
        description: 'Consulting',
        quantity: 1,
        unitPriceNet: 100,
        taxCategory: 'standard',
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as OfferEntity;
  let stored: OfferEntity;
  const offersRepository = {
    findByIdOrThrow: jest.fn(async () => stored),
    update: jest.fn(async (_id: string, patch: Partial<OfferEntity>) => {
      stored = { ...stored, ...patch } as OfferEntity;

      return stored;
    }),
    claimSent: jest.fn(),
    releaseSent: jest.fn(),
  };
  const offerLineItemsRepository = { findByOfferId: jest.fn(async () => draft.lineItems), update: jest.fn() };
  const offerPdfService = {
    generateAndStore: jest.fn().mockResolvedValue('user-1/offer-1.pdf'),
    readPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
  };
  const billingEmailPublisher = { publishOfferArchived: jest.fn() };
  const auditLog = { log: jest.fn() };
  const searchIndex = { scheduleUpsert: jest.fn() };
  const service = new OfferArchiveService(
    offersRepository as never,
    offerLineItemsRepository as never,
    { nextOfferNumber: jest.fn().mockResolvedValue({ number: 'OFF-2026-00001', numberScope: 'shared' }) } as never,
    { findByIdForTenant: jest.fn().mockResolvedValue({ email: 'user@example.com' }) } as never,
    { prepareForUser: jest.fn() } as never,
    {
      computeLines: jest.fn().mockReturnValue({
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
        subtotalNet: 100,
        taxTotal: 19,
        totalGross: 119,
        resolvedTaxRate: 19,
      }),
    } as never,
    {
      resolveForUser: jest.fn().mockResolvedValue({
        treatment: { taxMode: 'domestic_vat', taxCountryCode: 'DE', einvoiceTaxCategoryCode: 'S', issuerIsInEu: true },
        forceChargeNonEuIssuerEuB2b: false,
      }),
    } as never,
    {
      getByUserId: jest.fn().mockResolvedValue({ userId: 'user-1' }),
      isProfileComplete: jest.fn().mockReturnValue(true),
    } as never,
    { assertConfigured: jest.fn(), getConfig: jest.fn(() => ({ name: 'Issuer' })) } as never,
    offerPdfService as never,
    billingEmailPublisher as never,
    { publishOffer: jest.fn() } as never,
    searchIndex as never,
    auditLog as never,
    new BillingDocumentTermsConfigService(),
  );
  const archived = (patch: Partial<OfferEntity> = {}): OfferEntity =>
    ({
      ...draft,
      status: OfferStatus.ARCHIVED,
      offerNumber: 'OFF-2026-00001',
      pdfStorageKey: 'user-1/offer-1.pdf',
      sentAt: null,
      notifyOnExpiry: true,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      ...patch,
    }) as OfferEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    stored = draft;
    billingEmailPublisher.publishOfferArchived.mockResolvedValue(true);
    offersRepository.claimSent.mockResolvedValue(true);
  });

  it('archives and sends by default (sentAt = archivedAt, expiry email on)', async () => {
    const result = await service.archive('offer-1', 'admin-1');
    const patch = offersRepository.update.mock.calls[0]?.[1] as Partial<OfferEntity>;

    expect(patch.sentAt).toBeInstanceOf(Date);
    expect(patch.sentAt).toBe(patch.archivedAt);
    expect(patch.notifyOnExpiry).toBe(true);
    expect(billingEmailPublisher.publishOfferArchived).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ canSend: false, notifyOnExpiry: true }));
    expect(result.sentAt).not.toBeNull();
  });

  it('archives without sending: no email, sentAt stays null, the offer can be sent later', async () => {
    const result = await service.archive('offer-1', 'admin-1', { notifyCustomer: false, notifyOnExpiry: false });

    expect(offersRepository.update).toHaveBeenNthCalledWith(
      1,
      'offer-1',
      expect.objectContaining({ status: OfferStatus.ARCHIVED, sentAt: null, notifyOnExpiry: false }),
    );
    expect(billingEmailPublisher.publishOfferArchived).not.toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        process: 'offer.archive',
        context: expect.objectContaining({ notifyCustomer: false, notifyOnExpiry: false }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ sentAt: null, canSend: true, notifyOnExpiry: false }));
  });

  it.each([
    ['a draft', { status: OfferStatus.DRAFT }],
    ['an accepted offer', { status: OfferStatus.ACCEPTED }],
    ['a revoked offer', { status: OfferStatus.REVOKED }],
    ['an offer already sent', { sentAt: new Date('2026-01-02T00:00:00Z') }],
    ['an offer past its expiry', { expiresAt: new Date('2020-01-01T00:00:00Z') }],
  ])('assertOfferSendable refuses %s', (_label, patch) => {
    expect(() => service.assertOfferSendable(archived(patch as Partial<OfferEntity>))).toThrow(BadRequestException);
  });

  it('marks an archived offer as sent manually (no email), audits and re-indexes it', async () => {
    stored = archived();

    await service.markSent('offer-1', 'admin-1', { sentAt: new Date(Date.now() - 60_000).toISOString() });

    expect(offersRepository.claimSent).toHaveBeenCalledWith('offer-1', expect.any(Date), 'manual');
    expect(billingEmailPublisher.publishOfferArchived).not.toHaveBeenCalled();
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ process: 'offer.mark_sent', offerId: 'offer-1' }),
    );
    expect(searchIndex.scheduleUpsert).toHaveBeenCalled();
  });

  it('refuses to mark an offer sent before it was archived or twice', async () => {
    stored = archived({ archivedAt: new Date('2026-01-01T00:00:00Z') });
    await expect(service.markSent('offer-1', 'admin-1', { sentAt: '2000-01-01T00:00:00Z' })).rejects.toThrow(
      /before the document was finalized/,
    );

    offersRepository.claimSent.mockResolvedValue(false);
    await expect(service.markSent('offer-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renders the PDF first when the stored file is missing', async () => {
    stored = archived({ pdfStorageKey: null });

    await expect(service.getStoredPdfKey(stored)).resolves.toBe('user-1/offer-1.pdf');
    expect(offerPdfService.generateAndStore).toHaveBeenCalledTimes(1);
  });
});
