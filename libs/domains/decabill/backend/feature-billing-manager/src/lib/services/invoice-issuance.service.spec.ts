import { InvoiceStatus } from '../constants/invoice-status.constants';
import { TaxCategory } from '../constants/tax-category.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

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
    {
      publishInvoice: jest.fn(),
      publishPayment: jest.fn(),
      publishSubscription: jest.fn(),
      publish: jest.fn(),
    } as never,
    {
      scheduleIfEligible: jest.fn(),
    } as never,
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

  it('skips invoice email when skipNotification is set', async () => {
    await service.issueDraft('inv-1', 14, { skipNotification: true });

    expect(billingEmailPublisher.publishInvoiceIssued).not.toHaveBeenCalled();
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
