import { BadRequestException, NotFoundException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferEntity } from '../entities/offer.entity';

import { BillingDocumentTermsConfigService } from '../../services/billing-document-terms-config.service';
import { DeliveryTermsCode } from '../../constants/document-terms.constants';
import { OfferLineType } from '../constants/offer-line-type.constants';

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
