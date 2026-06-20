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

export interface PaymentStatusUpdate {
  invoiceId: string;
  externalId: string;
  status: 'succeeded' | 'failed' | 'canceled' | 'pending';
  amountPaid?: number;
  tenantId?: string;
}

export interface PaymentProcessor {
  getType(): string;
  getDisplayName(): string;
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult>;
  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean;
  parseWebhookEvent(rawBody: Buffer | string): { eventId: string; type: string; data: unknown };
  mapWebhookToPaymentUpdate(event: { type: string; data: unknown }): PaymentStatusUpdate | null;
}
