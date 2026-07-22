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
});
