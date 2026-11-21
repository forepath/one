export interface CreateCheckoutSessionParams {
  invoiceId: string;
  amount: number;
  currency: string;
  customerEmail?: string;
  stripeCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  externalId: string;
}

export interface CreateSetupSessionParams {
  customerEmail?: string;
  stripeCustomerId?: string;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface SetupSessionResult {
  setupUrl: string;
  externalId: string;
  stripeCustomerId?: string;
}

export interface ChargeOffSessionParams {
  invoiceId: string;
  amount: number;
  currency: string;
  stripeCustomerId: string;
  paymentMethodExternalId: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface ChargeOffSessionResult {
  externalId: string;
  status: 'succeeded' | 'failed' | 'pending';
  paymentMethodExternalId?: string;
}

export interface PaymentStatusUpdate {
  invoiceId: string;
  externalId: string;
  status: 'succeeded' | 'failed' | 'canceled' | 'pending';
  amountPaid?: number;
  tenantId?: string;
  userId?: string;
  mode?: 'auto' | 'checkout';
  paymentMethodExternalId?: string;
  stripeCustomerId?: string;
  /** When the money was received (processor event time); defaults to processing time. */
  occurredAt?: Date;
  /** Processor payment id used for refunds and fee reconciliation (e.g. Stripe PaymentIntent of a checkout). */
  paymentIntentId?: string;
}

export interface SetupStatusUpdate {
  externalId: string;
  status: 'succeeded' | 'failed' | 'canceled';
  tenantId?: string;
  userId?: string;
  paymentMethodExternalId?: string;
  stripeCustomerId?: string;
}

export interface RefundPaymentParams {
  /** Checkout session id or the processor's payment id (e.g. Stripe `cs_…` or `pi_…`). */
  externalCheckoutSessionId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface RefundPaymentResult {
  externalRefundId: string;
}

/** One movement on the processor balance (charge, fee, refund, payout …), amounts in major units. */
export interface ProcessorBalanceTransaction {
  id: string;
  /** Processor type (`charge`, `payment`, `refund`, `payout`, `stripe_fee`, `adjustment` …). */
  type: string;
  reportingCategory?: string;
  /** Signed gross amount (+ into the balance). */
  amount: number;
  /** Processing fee (positive = charged by the processor). */
  fee: number;
  net: number;
  currency: string;
  created: Date;
  availableOn?: Date;
  sourceId?: string;
  paymentIntentId?: string;
  /** Decabill invoice id from payment metadata, when available. */
  invoiceId?: string;
  payoutId?: string;
  description?: string;
}

export interface ListBalanceTransactionsParams {
  /** Only movements created after this time. */
  createdAfter?: Date;
  startingAfter?: string;
  limit: number;
}

export interface PaymentProcessor {
  getType(): string;
  getDisplayName(): string;
  /** Marker: processor can collect a default PM and charge invoices off-session. */
  supportsAutoPayment(): boolean;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult>;
  createSetupSession(params: CreateSetupSessionParams): Promise<SetupSessionResult>;
  chargeOffSession(params: ChargeOffSessionParams): Promise<ChargeOffSessionResult>;
  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean;
  parseWebhookEvent(rawBody: Buffer | string): { eventId: string; type: string; data: unknown; created?: number };
  mapWebhookToPaymentUpdate(event: {
    type: string;
    data: unknown;
  }): Promise<PaymentStatusUpdate | null> | PaymentStatusUpdate | null;
  mapWebhookToSetupUpdate(event: {
    type: string;
    data: unknown;
  }): Promise<SetupStatusUpdate | null> | SetupStatusUpdate | null;
  refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult>;
  /**
   * Optional: balance movements for automatic accounting (fees, payouts). Processors without an API for it are
   * reconciled from uploaded settlement reports instead.
   */
  listBalanceTransactions?(
    params: ListBalanceTransactionsParams,
  ): Promise<{ items: ProcessorBalanceTransaction[]; hasMore: boolean }>;
}
