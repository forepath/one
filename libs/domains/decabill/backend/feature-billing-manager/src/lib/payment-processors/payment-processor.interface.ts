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
  externalCheckoutSessionId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export interface RefundPaymentResult {
  externalRefundId: string;
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
  parseWebhookEvent(rawBody: Buffer | string): { eventId: string; type: string; data: unknown };
  mapWebhookToPaymentUpdate(event: {
    type: string;
    data: unknown;
  }): Promise<PaymentStatusUpdate | null> | PaymentStatusUpdate | null;
  mapWebhookToSetupUpdate(event: {
    type: string;
    data: unknown;
  }): Promise<SetupStatusUpdate | null> | SetupStatusUpdate | null;
  refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult>;
}
