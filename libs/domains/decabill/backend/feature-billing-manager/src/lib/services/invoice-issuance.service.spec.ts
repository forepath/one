import { DeliveryTermsCode } from '../constants/document-terms.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { BillingDocumentTermsConfigService } from './billing-document-terms-config.service';
import { InvoiceIssuanceService } from './invoice-issuance.service';

describe('InvoiceIssuanceService', () => {
  const invoicesRepository = {
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const invoiceLineItemsRepository = {
    findByInvoiceId: jest.fn(),
  };
  const invoiceNumberSequencesRepository = {
    nextInvoiceNumber: jest.fn(),
  };
  const customerProfilesRepository = {
    findByUserId: jest.fn(),
  };
  const subscriptionsRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const servicePlansRepository = {
    findByIdOrThrow: jest.fn(),
  };
  const billingIssuerConfig = {
    assertConfigured: jest.fn(),
    getConfig: jest.fn().mockReturnValue({
      name: 'Issuer',
      vatId: 'DE1',
      addressLine1: 'A',
      postalCode: '1',
      city: 'C',
      country: 'DE',
    }),
  };
  const invoicePdfService = {
    generateAndStore: jest.fn(),
  };
  const billingEmailPublisher = {
    publishInvoiceIssued: jest.fn(),
  };
  const auditLog = {
    log: jest.fn(),
  };
  const customerTrustScoreService = {
    triggerRecomputeForUser: jest.fn(),
  };
  const invoiceTaxContextService = {
    resolveForUser: jest.fn().mockResolvedValue({
      treatment: {
        taxMode: 'domestic_vat',
        taxCountryCode: 'DE',
        chargeVat: true,
        taxNote: null,
        einvoiceTaxCategoryCode: 'S',
        issuerIsInEu: true,
      },
      forceChargeNonEuIssuerEuB2b: false,
      buyerVatId: null,
      buyerCountry: 'DE',
      buyerCustomerType: 'consumer',
      issuerCountry: 'DE',
      countsTowardOssLedger: false,
    }),
  };
  const ossThresholdService = {
    recordCrossBorderB2cNet: jest.fn(),
  };
  const billingSearchIndexService = { scheduleUpsert: jest.fn(), scheduleDelete: jest.fn() };
  const billingNotificationPublisher = {
    publishInvoice: jest.fn(),
    publishPayment: jest.fn(),
    publishSubscription: jest.fn(),
    publish: jest.fn(),
  };
  const documentTermsConfig = new BillingDocumentTermsConfigService();
  const service = new InvoiceIssuanceService(
    invoicesRepository as never,
    invoiceLineItemsRepository as never,
    invoiceNumberSequencesRepository as never,
    customerProfilesRepository as never,
    subscriptionsRepository as never,
    servicePlansRepository as never,
    billingIssuerConfig as never,
    invoicePdfService as never,
    billingEmailPublisher as never,
    auditLog as never,
    billingNotificationPublisher as never,
    {
      scheduleIfEligible: jest.fn(),
    } as never,
    customerTrustScoreService as never,
    invoiceTaxContextService as never,
    ossThresholdService as never,
    billingSearchIndexService as never,
    documentTermsConfig,
  );
  const draftInvoice = {
    id: 'inv-1',
    userId: 'user-1',
    subscriptionId: 'sub-1',
    status: InvoiceStatus.DRAFT,
    totalGross: 119,
    subtotalNet: 100,
    taxTotal: 19,
    balanceDue: 119,
    currency: 'EUR',
  } as InvoiceEntity;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BILLING_DEFAULT_PAYMENT_PROCESSOR = 'stripe';
    billingIssuerConfig.getConfig.mockReturnValue({
      name: 'Issuer',
      vatId: 'DE1',
      addressLine1: 'A',
      postalCode: '1',
      city: 'C',
      country: 'DE',
    });
    invoiceTaxContextService.resolveForUser.mockResolvedValue({
      treatment: {
        taxMode: 'domestic_vat',
        taxCountryCode: 'DE',
        chargeVat: true,
        taxNote: null,
        einvoiceTaxCategoryCode: 'S',
        issuerIsInEu: true,
      },
      forceChargeNonEuIssuerEuB2b: false,
      buyerVatId: null,
      buyerCountry: 'DE',
      buyerCustomerType: 'consumer',
      issuerCountry: 'DE',
      countsTowardOssLedger: false,
    });
    invoicesRepository.findByIdOrThrow.mockResolvedValue(draftInvoice);
    invoiceLineItemsRepository.findByInvoiceId.mockResolvedValue([
      {
        position: 0,
        description: 'Item',
        quantity: 1,
        unitPriceNet: 100,
        taxRate: 19,
        lineNet: 100,
        lineTax: 19,
        lineGross: 119,
        taxCategory: TaxCategory.STANDARD,
      },
    ]);
    customerProfilesRepository.findByUserId.mockResolvedValue({
      userId: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    });
    subscriptionsRepository.findByIdOrThrow.mockResolvedValue({
      id: 'sub-1',
      planId: 'plan-1',
      number: 'SUB-2026-00001',
      currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    });
    servicePlansRepository.findByIdOrThrow.mockResolvedValue({
      id: 'plan-1',
      billingIntervalType: 'month',
      billInAdvance: false,
      autoRecalculatePriceDaily: false,
      billingIntervalValue: 1,
      billingDayOfMonth: 1,
    });
    invoiceNumberSequencesRepository.nextInvoiceNumber.mockResolvedValue('INV-2026-00001');
    invoicesRepository.update
      .mockResolvedValueOnce({
        ...draftInvoice,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
      })
      .mockResolvedValueOnce({
        ...draftInvoice,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
        pdfStorageKey: 'sub-1/inv-1.pdf',
      });
    invoicePdfService.generateAndStore.mockResolvedValue('sub-1/inv-1.pdf');
  });

  it('issues draft invoice with number, dates, and PDF', async () => {
    const result = await service.issueDraft('inv-1');

    expect(billingIssuerConfig.assertConfigured).toHaveBeenCalled();
    expect(invoiceNumberSequencesRepository.nextInvoiceNumber).toHaveBeenCalledWith(new Date().getFullYear());
    expect(invoicesRepository.update).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
        paymentProcessor: 'stripe',
      }),
    );
    expect(invoicePdfService.generateAndStore).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'SUB-2026-00001',
      expect.objectContaining({
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
      }),
    );
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({ process: 'invoice.issue', invoiceId: 'inv-1' }),
    );
    expect(result.pdfStorageKey).toBe('sub-1/inv-1.pdf');
    expect(billingEmailPublisher.publishInvoiceIssued).toHaveBeenCalledWith(
      expect.objectContaining({ pdfStorageKey: 'sub-1/inv-1.pdf' }),
      'sub-1/inv-1.pdf',
    );
  });

  it('issues manual invoice draft without subscription', async () => {
    const manualDraft = {
      ...draftInvoice,
      subscriptionId: undefined,
    } as InvoiceEntity;

    invoicesRepository.findByIdOrThrow.mockResolvedValue(manualDraft);
    invoicesRepository.update.mockReset();
    invoicesRepository.update
      .mockResolvedValueOnce({
        ...manualDraft,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date('2026-06-01T00:00:00Z'),
      })
      .mockResolvedValueOnce({
        ...manualDraft,
        invoiceNumber: 'INV-2026-00001',
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date('2026-06-01T00:00:00Z'),
        pdfStorageKey: 'manual/user-1/inv-1.pdf',
      });
    invoicePdfService.generateAndStore.mockResolvedValue('manual/user-1/inv-1.pdf');

    const result = await service.issueDraft('inv-1');

    expect(subscriptionsRepository.findByIdOrThrow).not.toHaveBeenCalled();
    expect(servicePlansRepository.findByIdOrThrow).not.toHaveBeenCalled();
    expect(invoicePdfService.generateAndStore).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      '',
      expect.objectContaining({
        periodStart: expect.any(Date),
        periodEnd: expect.any(Date),
      }),
    );
    expect(result.pdfStorageKey).toBe('manual/user-1/inv-1.pdf');
  });

  it('publishes invoice.paid when a promotional zero-balance invoice is issued as paid', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({ ...draftInvoice, balanceDue: 0 } as InvoiceEntity);
    invoicesRepository.update.mockReset();
    let stored = { ...draftInvoice, balanceDue: 0 } as InvoiceEntity;

    invoicesRepository.update.mockImplementation(async (_id: string, patch: Partial<InvoiceEntity>) => {
      stored = { ...stored, ...patch } as InvoiceEntity;

      return stored;
    });

    await service.issueDraft('inv-1');

    expect(billingNotificationPublisher.publishInvoice).toHaveBeenCalledWith(
      'invoice.paid',
      expect.objectContaining({ id: 'inv-1', status: InvoiceStatus.PAID }),
    );
  });

  it('does not publish invoice.paid for a regular issued invoice', async () => {
    await service.issueDraft('inv-1');

    expect(billingNotificationPublisher.publishInvoice).not.toHaveBeenCalledWith('invoice.paid', expect.anything());
  });

  it('skips invoice email when skipNotification is set', async () => {
    await service.issueDraft('inv-1', { skipNotification: true });

    expect(billingEmailPublisher.publishInvoiceIssued).not.toHaveBeenCalled();
  });

  describe('payment and delivery terms', () => {
    const updatePatch = (): Partial<InvoiceEntity> =>
      (invoicesRepository.update.mock.calls[0] as [string, Partial<InvoiceEntity>])[1];
    const daysUntilDue = (patch: Partial<InvoiceEntity>): number =>
      Math.round(((patch.dueDate as Date).getTime() - (patch.issuedAt as Date).getTime()) / 86_400_000);

    afterEach(() => {
      delete process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS;
      delete process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE;
      delete process.env.BILLING_DEFAULT_DELIVERY_TERMS_PLACE;
      documentTermsConfig.onModuleInit();
    });

    it('falls back to 14 days and no delivery terms without plan or global settings', async () => {
      documentTermsConfig.onModuleInit();

      await service.issueDraft('inv-1');

      expect(updatePatch()).toEqual(
        expect.objectContaining({
          paymentDueDays: 14,
          deliveryTermsCode: null,
          deliveryTermsPlace: null,
          deliveryTermsText: null,
        }),
      );
      expect(daysUntilDue(updatePatch())).toBe(14);
    });

    it('uses the global default when the plan leaves terms empty', async () => {
      process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS = '21';
      process.env.BILLING_DEFAULT_DELIVERY_TERMS_CODE = 'exw';
      process.env.BILLING_DEFAULT_DELIVERY_TERMS_PLACE = 'Munich';
      documentTermsConfig.onModuleInit();

      await service.issueDraft('inv-1');

      expect(updatePatch()).toEqual(
        expect.objectContaining({
          paymentDueDays: 21,
          deliveryTermsCode: DeliveryTermsCode.EXW,
          deliveryTermsPlace: 'Munich',
        }),
      );
      expect(daysUntilDue(updatePatch())).toBe(21);
    });

    it('applies the subscription plan terms over the global default', async () => {
      process.env.BILLING_DEFAULT_PAYMENT_DUE_DAYS = '21';
      documentTermsConfig.onModuleInit();
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        billingIntervalType: 'month',
        billingIntervalValue: 1,
        paymentDueDays: 30,
        deliveryTermsCode: DeliveryTermsCode.DAP,
        deliveryTermsPlace: 'Berlin',
        deliveryTermsText: null,
      });

      await service.issueDraft('inv-1');

      expect(updatePatch()).toEqual(
        expect.objectContaining({
          paymentDueDays: 30,
          deliveryTermsCode: DeliveryTermsCode.DAP,
          deliveryTermsPlace: 'Berlin',
          deliveryTermsText: null,
        }),
      );
      expect(daysUntilDue(updatePatch())).toBe(30);
    });

    it('applies document overrides per facet over the plan', async () => {
      servicePlansRepository.findByIdOrThrow.mockResolvedValue({
        id: 'plan-1',
        billingIntervalType: 'month',
        billingIntervalValue: 1,
        paymentDueDays: 30,
        deliveryTermsCode: DeliveryTermsCode.DAP,
        deliveryTermsPlace: 'Berlin',
      });

      await service.issueDraft('inv-1', {
        terms: {
          paymentDueDays: null,
          deliveryTerms: { code: DeliveryTermsCode.CUSTOM, place: null, text: 'Online access' },
        },
      });

      expect(updatePatch()).toEqual(
        expect.objectContaining({
          paymentDueDays: 30,
          deliveryTermsCode: DeliveryTermsCode.CUSTOM,
          deliveryTermsPlace: null,
          deliveryTermsText: 'Online access',
        }),
      );
    });

    it('allows payable immediately (0 days)', async () => {
      await service.issueDraft('inv-1', { terms: { paymentDueDays: 0 } });

      expect(updatePatch()).toEqual(expect.objectContaining({ paymentDueDays: 0 }));
      expect(daysUntilDue(updatePatch())).toBe(0);
    });

    it('keeps delivery terms but drops payment terms on a promotional zero-balance invoice', async () => {
      invoicesRepository.findByIdOrThrow.mockResolvedValue({ ...draftInvoice, balanceDue: 0 } as InvoiceEntity);
      invoicesRepository.update.mockReset();
      invoicesRepository.update.mockImplementation(async (_id: string, patch: Partial<InvoiceEntity>) => ({
        ...draftInvoice,
        ...patch,
      }));

      await service.issueDraft('inv-1', {
        terms: { deliveryTerms: { code: DeliveryTermsCode.CUSTOM, place: null, text: 'Online access' } },
      });

      expect(updatePatch()).toEqual(
        expect.objectContaining({
          status: InvoiceStatus.PAID,
          dueDate: undefined,
          paymentDueDays: null,
          deliveryTermsCode: DeliveryTermsCode.CUSTOM,
          deliveryTermsText: 'Online access',
        }),
      );
    });

    it('resolves the plan before allocating an invoice number', async () => {
      servicePlansRepository.findByIdOrThrow.mockRejectedValue(new Error('plan missing'));

      await expect(service.issueDraft('inv-1')).rejects.toThrow('plan missing');
      expect(invoiceNumberSequencesRepository.nextInvoiceNumber).not.toHaveBeenCalled();
    });
  });

  it('throws when invoice is not a draft', async () => {
    invoicesRepository.findByIdOrThrow.mockResolvedValue({
      ...draftInvoice,
      status: InvoiceStatus.ISSUED,
    });

    await expect(service.issueDraft('inv-1')).rejects.toThrow('not a draft');
  });

  it('throws when customer profile is missing', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(null);

    await expect(service.issueDraft('inv-1')).rejects.toThrow('Customer profile required');
  });
});
