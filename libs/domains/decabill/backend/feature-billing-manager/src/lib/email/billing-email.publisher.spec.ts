import { BillingEmailPublisher } from './billing-email.publisher';

describe('BillingEmailPublisher', () => {
  const emailDispatcher = { publish: jest.fn() };
  const customerProfilesRepository = { findByUserId: jest.fn() };
  const usersRepository = { findByIdForTenant: jest.fn() };
  const publisher = new BillingEmailPublisher(
    emailDispatcher as never,
    customerProfilesRepository as never,
    usersRepository as never,
  );
  const profile = {
    email: 'billing@example.com',
    firstName: 'Ada',
  };
  const invoice = {
    id: 'inv-1',
    userId: 'user-1',
    invoiceNumber: 'INV-1',
    totalGross: 10,
    currency: 'EUR',
    dueDate: new Date('2026-08-01'),
    timeReportStorageKey: null as string | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    emailDispatcher.publish.mockResolvedValue(undefined);
    customerProfilesRepository.findByUserId.mockResolvedValue(profile);
    usersRepository.findByIdForTenant.mockResolvedValue(null);
  });

  it('publishes invoice issued email with attachment refs', async () => {
    await publisher.publishInvoiceIssued(invoice as never, 'pdf-key');

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'invoice.issued',
        to: 'billing@example.com',
        templateKey: 'invoice-issued',
        attachments: [{ storageKey: 'pdf-key', filename: 'INV-1.pdf' }],
        templateContext: expect.objectContaining({
          recipientName: 'Ada',
          invoiceNumber: 'INV-1',
          amountLabel: '10.00 EUR',
          dueDateLabel: expect.any(String),
        }),
      }),
    );
  });

  it('reports whether the delivery email was queued (true / false)', async () => {
    await expect(publisher.publishInvoiceIssued(invoice as never, 'pdf-key')).resolves.toBe(true);
    await expect(publisher.publishVoidDocument(invoice as never, 'void-key', 'INV-1-CN')).resolves.toBe(true);
    await expect(
      publisher.publishOfferArchived(
        { id: 'o1', userId: 'user-1', offerNumber: 'OFF-1', totalGross: 1, currency: 'EUR' } as never,
        'k',
      ),
    ).resolves.toBe(true);

    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await expect(publisher.publishInvoiceIssued(invoice as never, 'pdf-key')).resolves.toBe(false);
    await expect(publisher.publishVoidDocument(invoice as never, 'void-key', 'INV-1-CN')).resolves.toBe(false);
    await expect(publisher.publishInvoiceIssued({ ...invoice, invoiceNumber: null } as never, 'k')).resolves.toBe(
      false,
    );
  });

  it('publishes offer revoked and expired emails without attachment', async () => {
    const offer = {
      id: 'offer-1',
      userId: 'user-1',
      offerNumber: 'OFF-2026-00001',
      totalGross: 119,
      currency: 'EUR',
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    };

    await expect(publisher.publishOfferRevoked(offer as never)).resolves.toBe(true);
    await expect(publisher.publishOfferExpired(offer as never)).resolves.toBe(true);

    expect(emailDispatcher.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'offer.revoked',
        templateKey: 'offer-revoked',
        to: 'billing@example.com',
        templateContext: expect.objectContaining({ offerNumber: 'OFF-2026-00001', amountLabel: '119.00 EUR' }),
      }),
    );
    expect(emailDispatcher.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'offer.expired',
        templateKey: 'offer-expired',
        templateContext: expect.objectContaining({ expiresAtLabel: expect.any(String) }),
      }),
    );
    expect(emailDispatcher.publish.mock.calls[0]?.[0]).not.toHaveProperty('attachments');
  });

  it('publishes offer accepted / declined confirmations and reports whether they were queued', async () => {
    const offer = { id: 'offer-1', userId: 'user-1', offerNumber: 'OFF-1', totalGross: 119, currency: 'EUR' };

    await expect(publisher.publishOfferAcceptedConfirmation(offer as never)).resolves.toBe(true);
    await expect(publisher.publishOfferDeclinedConfirmation(offer as never)).resolves.toBe(true);
    expect(emailDispatcher.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ eventType: 'offer.accepted', templateKey: 'offer-accepted-confirmation' }),
    );
    expect(emailDispatcher.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'offer.declined',
        templateKey: 'offer-declined-confirmation',
        to: 'billing@example.com',
        templateContext: expect.objectContaining({ offerNumber: 'OFF-1', amountLabel: '119.00 EUR' }),
      }),
    );
    expect(emailDispatcher.publish.mock.calls[1]?.[0]).not.toHaveProperty('attachments');

    await expect(
      publisher.publishOfferDeclinedConfirmation({ userId: 'user-1', offerNumber: null } as never),
    ).resolves.toBe(false);
    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    await expect(publisher.publishOfferAcceptedConfirmation({ ...offer, userId: 'user-x' } as never)).resolves.toBe(
      false,
    );
    expect(emailDispatcher.publish).toHaveBeenCalledTimes(2);
  });

  it('skips offer revoked / expired emails without number or recipient', async () => {
    await expect(publisher.publishOfferRevoked({ userId: 'user-1', offerNumber: null } as never)).resolves.toBe(false);

    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    await expect(
      publisher.publishOfferExpired({
        userId: 'user-1',
        offerNumber: 'OFF-1',
        totalGross: 1,
        currency: 'EUR',
      } as never),
    ).resolves.toBe(false);
    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('includes time report attachment when present', async () => {
    await publisher.publishInvoiceIssued({ ...invoice, timeReportStorageKey: 'time-key' } as never, 'pdf-key');

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          { storageKey: 'pdf-key', filename: 'INV-1.pdf' },
          { storageKey: 'time-key', filename: 'time-report-INV-1.pdf' },
        ],
      }),
    );
  });

  it('skips invoice email without invoice number', async () => {
    await publisher.publishInvoiceIssued({ ...invoice, invoiceNumber: null } as never, 'pdf-key');

    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('skips when recipient cannot be resolved', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await publisher.publishInvoiceIssued(invoice as never, 'pdf-key');

    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('falls back to user email when profile email is missing', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({ firstName: 'Ada', email: '  ' });
    usersRepository.findByIdForTenant.mockResolvedValue({ email: 'user@example.com' });

    await publisher.publishInvoiceIssued({ ...invoice, dueDate: 'not-a-date' } as never, 'pdf-key');

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        templateContext: expect.not.objectContaining({ dueDateLabel: expect.anything() }),
      }),
    );
  });

  it('publishes void document email', async () => {
    await publisher.publishVoidDocument(invoice as never, 'void-key', 'CN-1');

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'invoice.voided',
        templateKey: 'invoice-voided',
        attachments: [{ storageKey: 'void-key', filename: 'CN-1.pdf' }],
        templateContext: {
          recipientName: 'Ada',
          invoiceNumber: 'INV-1',
          creditNoteNumber: 'CN-1',
        },
      }),
    );
  });

  it('skips void document without invoice number or recipient', async () => {
    await publisher.publishVoidDocument({ ...invoice, invoiceNumber: undefined } as never, 'void-key', 'CN-1');
    expect(emailDispatcher.publish).not.toHaveBeenCalled();

    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    usersRepository.findByIdForTenant.mockResolvedValue(null);
    await publisher.publishVoidDocument(invoice as never, 'void-key', 'CN-1');
    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('publishes partial credit document email', async () => {
    await publisher.publishPartialCreditDocument(invoice as never, 'credit-key', 'CN-2', 4.5);

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'invoice.partial_credit_issued',
        templateKey: 'invoice-partial-credit',
        attachments: [{ storageKey: 'credit-key', filename: 'CN-2.pdf' }],
        templateContext: expect.objectContaining({
          creditNoteNumber: 'CN-2',
          creditAmountLabel: '4.50 EUR',
        }),
      }),
    );
  });

  it('skips partial credit without invoice number or recipient', async () => {
    await publisher.publishPartialCreditDocument({ ...invoice, invoiceNumber: '' } as never, 'k', 'CN', 1);
    expect(emailDispatcher.publish).not.toHaveBeenCalled();

    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    usersRepository.findByIdForTenant.mockResolvedValue(null);
    await publisher.publishPartialCreditDocument(invoice as never, 'k', 'CN', 1);
    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('publishes renewal reminder', async () => {
    await publisher.publishRenewalReminder({ id: 'sub-1' } as never, 'Pro Plan', 'a@example.com', 'Ada', '2026-09-01');

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'subscription.renewal_reminder',
        templateKey: 'subscription-renewal-reminder',
        to: 'a@example.com',
        templateContext: {
          recipientName: 'Ada',
          planName: 'Pro Plan',
          renewalDate: '2026-09-01',
          subscriptionId: 'sub-1',
          billInAdvance: false,
        },
      }),
    );
  });

  it('publishes withdrawal confirmation with expiry text', async () => {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    await publisher.publishWithdrawalConfirmation('a@example.com', 'ABC123', expiresAt);

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'withdrawal.confirmation_requested',
        templateKey: 'withdrawal-confirmation',
        to: 'a@example.com',
        templateContext: expect.objectContaining({
          code: 'ABC123',
          expiryText: expect.stringMatching(/hours?$/),
        }),
      }),
    );
  });

  it('publishes payment succeeded and failed emails', async () => {
    await publisher.publishPaymentSucceeded(invoice as never, { processor: 'stripe' });
    await publisher.publishPaymentFailed(invoice as never);

    expect(emailDispatcher.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'payment.succeeded',
        templateKey: 'payment-succeeded',
        templateContext: expect.objectContaining({ processor: 'stripe' }),
      }),
    );
    expect(emailDispatcher.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'payment.failed',
        templateKey: 'payment-failed',
      }),
    );
  });

  it('skips payment emails without invoice number or recipient', async () => {
    await publisher.publishPaymentSucceeded({ ...invoice, invoiceNumber: null } as never);
    expect(emailDispatcher.publish).not.toHaveBeenCalled();

    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    usersRepository.findByIdForTenant.mockResolvedValue(null);
    await publisher.publishPaymentFailed(invoice as never);
    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('publishes subscription canceled email', async () => {
    await publisher.publishSubscriptionCanceled(
      {
        userId: 'user-1',
        cancelEffectiveAt: new Date('2026-10-01'),
      } as never,
      'Pro Plan',
    );

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'subscription.canceled',
        templateKey: 'subscription-canceled',
        templateContext: expect.objectContaining({
          planName: 'Pro Plan',
          effectiveDate: expect.any(String),
        }),
      }),
    );
  });

  it('publishes order confirmation email', async () => {
    await publisher.publishSubscriptionCreated(
      {
        userId: 'user-1',
        number: 'SUB-42',
        currentPeriodEnd: new Date('2026-10-01'),
      } as never,
      'Pro Plan',
      { billInAdvance: true },
    );

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'subscription.created',
        templateKey: 'subscription-created',
        templateContext: expect.objectContaining({
          planName: 'Pro Plan',
          subscriptionNumber: 'SUB-42',
          billInAdvance: true,
          periodEndDate: expect.any(String),
        }),
      }),
    );
  });

  it('publishes withdrawal completed email', async () => {
    await publisher.publishSubscriptionWithdrawn(
      {
        userId: 'user-1',
        number: 'SUB-42',
        withdrawnAt: new Date('2026-10-01'),
      } as never,
      'Pro Plan',
    );

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'subscription.withdrawn',
        templateKey: 'subscription-withdrawn',
        templateContext: expect.objectContaining({
          planName: 'Pro Plan',
          subscriptionNumber: 'SUB-42',
          withdrawnAt: expect.any(String),
        }),
      }),
    );
  });

  it('skips subscription canceled when recipient is missing', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue(null);
    usersRepository.findByIdForTenant.mockResolvedValue(null);

    await publisher.publishSubscriptionCanceled({ userId: 'user-1' } as never, 'Pro Plan');

    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });

  it('uses Customer greeting when firstName is empty', async () => {
    customerProfilesRepository.findByUserId.mockResolvedValue({ email: 'billing@example.com', firstName: '  ' });

    await publisher.publishInvoiceIssued({ ...invoice, dueDate: null } as never, 'pdf-key');

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        templateContext: expect.objectContaining({ recipientName: 'Customer' }),
      }),
    );
  });

  it('publishes consolidated price-change email with idempotent correlation id', async () => {
    await publisher.publishPriceChangedConsolidated({
      tenantId: 'tenant-a',
      userId: 'user-1',
      runDate: '2026-07-25',
      withdrawalPeriodDays: 14,
      changes: [
        {
          subscriptionNumber: 'SUB-1',
          productName: 'Pro VPS',
          oldNet: 10,
          oldTax: 1.9,
          oldTotal: 11.9,
          newNet: 12,
          newTax: 2.28,
          newTotal: 14.28,
        },
      ],
    });

    expect(emailDispatcher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'subscription.price_changed',
        templateKey: 'price-change',
        correlationId: 'price-recalc:tenant-a:user-1:2026-07-25',
        to: 'billing@example.com',
        templateContext: expect.objectContaining({
          recipientName: 'Ada',
          withdrawalPeriodDays: 14,
          changes: [
            expect.objectContaining({
              subscriptionNumber: 'SUB-1',
              productName: 'Pro VPS',
              oldNet: '10.00 EUR',
              oldTax: '1.90 EUR',
              oldTotal: '11.90 EUR',
              newNet: '12.00 EUR',
              newTax: '2.28 EUR',
              newTotal: '14.28 EUR',
            }),
          ],
        }),
      }),
    );
  });

  it('skips consolidated price-change email when changes are empty', async () => {
    await publisher.publishPriceChangedConsolidated({
      tenantId: 'tenant-a',
      userId: 'user-1',
      runDate: '2026-07-25',
      withdrawalPeriodDays: 14,
      changes: [],
    });

    expect(emailDispatcher.publish).not.toHaveBeenCalled();
  });
});
