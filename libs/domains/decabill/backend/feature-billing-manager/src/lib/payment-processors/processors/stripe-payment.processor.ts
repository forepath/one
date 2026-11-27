import { Injectable, Logger } from '@nestjs/common';
import StripeCtor from 'stripe';

import {
  ChargeOffSessionParams,
  ChargeOffSessionResult,
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  CreateSetupSessionParams,
  ListBalanceTransactionsParams,
  SetupSessionResult,
  PaymentProcessor,
  ProcessorBalanceTransaction,
  PaymentStatusUpdate,
  RefundPaymentParams,
  RefundPaymentResult,
  SetupStatusUpdate,
} from '../payment-processor.interface';
import {
  buildStripeCheckoutSessionCreateParams,
  buildStripeSetupSessionCreateParams,
} from '../stripe-checkout-session.utils';
import { isStripeCheckoutFraudProtectionEnabled } from '../stripe-checkout.config';

type StripeClient = ReturnType<typeof StripeCtor>;

/**
 * Stripe API version every request is sent with. Pinned explicitly so the API generation only changes
 * with a deliberate SDK bump, not with the account default. The SDK types the option as its own pin, so
 * typecheck and spec fail when an SDK bump moves it; update this value then. Webhook payloads use the
 * version configured on the webhook endpoint in the Stripe Dashboard, so update that one alongside.
 */
export const STRIPE_API_VERSION = '2026-11-18.endive' as const;

interface StripeCheckoutSessionPayload {
  id: string;
  mode?: string | null;
  metadata?: Record<string, string | undefined>;
  client_reference_id?: string | null;
  amount_total?: number | null;
  payment_status?: string | null;
  customer?: string | { id?: string } | null;
  payment_intent?: string | { id?: string; payment_method?: string | { id?: string } | null } | null;
  setup_intent?: string | { id?: string; payment_method?: string | { id?: string } | null } | null;
}

interface StripePaymentIntentPayload {
  id: string;
  status?: string | null;
  amount?: number | null;
  amount_received?: number | null;
  metadata?: Record<string, string | undefined>;
  customer?: string | { id?: string } | null;
  payment_method?: string | { id?: string } | null;
}

@Injectable()
export class StripePaymentProcessor implements PaymentProcessor {
  private readonly logger = new Logger(StripePaymentProcessor.name);
  private readonly stripe: StripeClient | null;
  private readonly webhookSecret: string;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY ?? '';

    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    this.stripe = secretKey ? new StripeCtor(secretKey, { apiVersion: STRIPE_API_VERSION }) : null;
  }

  getType(): string {
    return 'stripe';
  }

  getDisplayName(): string {
    return 'Stripe';
  }

  supportsAutoPayment(): boolean {
    return true;
  }

  private client(): StripeClient {
    if (!this.stripe) {
      throw new Error('Stripe is not configured');
    }

    return this.stripe;
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    const sessionParams = buildStripeCheckoutSessionCreateParams(params, {
      fraudProtectionEnabled: isStripeCheckoutFraudProtectionEnabled(),
    });
    const session = await this.client().checkout.sessions.create(sessionParams, {
      idempotencyKey: params.idempotencyKey,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return {
      checkoutUrl: session.url,
      externalId: session.id,
    };
  }

  async createSetupSession(params: CreateSetupSessionParams): Promise<SetupSessionResult> {
    let stripeCustomerId = params.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await this.client().customers.create(
        {
          email: params.customerEmail,
          metadata: params.metadata,
        },
        { idempotencyKey: `${params.idempotencyKey}-customer` },
      );

      stripeCustomerId = customer.id;
    }

    const session = await this.client().checkout.sessions.create(
      buildStripeSetupSessionCreateParams({ ...params, stripeCustomerId }),
      { idempotencyKey: params.idempotencyKey },
    );

    if (!session.url) {
      throw new Error('Stripe did not return a setup URL');
    }

    return {
      setupUrl: session.url,
      externalId: session.id,
      stripeCustomerId,
    };
  }

  async chargeOffSession(params: ChargeOffSessionParams): Promise<ChargeOffSessionResult> {
    try {
      const paymentIntent = await this.client().paymentIntents.create(
        {
          amount: Math.round(params.amount * 100),
          currency: params.currency.toLowerCase(),
          customer: params.stripeCustomerId,
          payment_method: params.paymentMethodExternalId,
          off_session: true,
          confirm: true,
          metadata: {
            ...params.metadata,
            mode: 'auto',
            invoiceId: params.invoiceId,
          },
        },
        { idempotencyKey: params.idempotencyKey },
      );
      const status =
        paymentIntent.status === 'succeeded'
          ? 'succeeded'
          : paymentIntent.status === 'processing' || paymentIntent.status === 'requires_action'
            ? 'pending'
            : 'failed';

      return {
        externalId: paymentIntent.id,
        status,
        paymentMethodExternalId: this.extractPaymentMethodId(paymentIntent.payment_method),
      };
    } catch (error) {
      this.logger.warn(`Stripe off-session charge failed: ${(error as Error).message}`);

      const stripeError = error as { payment_intent?: { id?: string } };

      return {
        externalId: stripeError.payment_intent?.id ?? `failed-${params.idempotencyKey}`,
        status: 'failed',
      };
    }
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!this.webhookSecret || !signature) {
      return false;
    }

    try {
      const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

      this.client().webhooks.constructEvent(payload, signature, this.webhookSecret);

      return true;
    } catch (error) {
      this.logger.warn(`Stripe webhook signature verification failed: ${(error as Error).message}`);

      return false;
    }
  }

  parseWebhookEvent(rawBody: Buffer | string): { eventId: string; type: string; data: unknown; created?: number } {
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const parsed = JSON.parse(payload) as { id: string; type: string; data: unknown; created?: number };

    return { eventId: parsed.id, type: parsed.type, data: parsed.data, created: parsed.created };
  }

  private minorToMajor(value: number | null | undefined): number | undefined {
    return value != null && Number.isFinite(value) ? value / 100 : undefined;
  }

  private eventTime(event: { created?: number }): Date | undefined {
    return typeof event.created === 'number' && Number.isFinite(event.created)
      ? new Date(event.created * 1000)
      : undefined;
  }

  async mapWebhookToPaymentUpdate(event: { type: string; data: unknown }): Promise<PaymentStatusUpdate | null> {
    if (event.type.startsWith('payment_intent.')) {
      return this.mapPaymentIntentUpdate(event);
    }

    const status = this.resolveCheckoutSessionStatus(event.type);

    if (!status) {
      return null;
    }

    let session = this.extractCheckoutSession(event.data);

    if (!session || session.mode === 'setup') {
      return null;
    }

    if (event.type === 'checkout.session.completed' && session.payment_status === 'unpaid') {
      return null;
    }

    const invoiceId = session.metadata?.invoiceId ?? session.client_reference_id;

    if (!invoiceId) {
      return null;
    }

    let paymentMethodExternalId = this.extractPaymentMethodFromSession(session);

    if (!paymentMethodExternalId && status === 'succeeded') {
      const expanded = await this.retrieveCheckoutSessionExpanded(session.id, ['payment_intent']);

      if (expanded) {
        session = expanded;
        paymentMethodExternalId = this.extractPaymentMethodFromSession(session);
      }
    }

    return {
      invoiceId,
      externalId: session.id,
      status,
      amountPaid: status === 'succeeded' && session.amount_total != null ? session.amount_total / 100 : undefined,
      occurredAt: this.eventTime(event as { created?: number }),
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent && typeof session.payment_intent === 'object'
            ? (session.payment_intent as { id?: string }).id
            : undefined,
      tenantId: session.metadata?.tenantId,
      userId: session.metadata?.userId,
      mode: 'checkout',
      paymentMethodExternalId,
      stripeCustomerId: this.extractCustomerId(session.customer),
    };
  }

  async mapWebhookToSetupUpdate(event: { type: string; data: unknown }): Promise<SetupStatusUpdate | null> {
    if (event.type === 'checkout.session.completed') {
      let session = this.extractCheckoutSession(event.data);

      if (!session || session.mode !== 'setup') {
        return null;
      }

      let paymentMethodExternalId = this.extractPaymentMethodFromSession(session);

      if (!paymentMethodExternalId) {
        const expanded = await this.retrieveCheckoutSessionExpanded(session.id, ['setup_intent']);

        if (expanded) {
          session = expanded;
          paymentMethodExternalId = this.extractPaymentMethodFromSession(session);
        }
      }

      if (!paymentMethodExternalId) {
        return null;
      }

      return {
        externalId: session.id,
        status: 'succeeded',
        tenantId: session.metadata?.tenantId,
        userId: session.metadata?.userId,
        paymentMethodExternalId,
        stripeCustomerId: this.extractCustomerId(session.customer),
      };
    }

    if (event.type === 'setup_intent.succeeded') {
      const setupIntent = this.extractPaymentIntentLike(event.data);

      if (!setupIntent) {
        return null;
      }

      const paymentMethodExternalId = this.extractPaymentMethodId(setupIntent.payment_method);

      if (!paymentMethodExternalId) {
        return null;
      }

      return {
        externalId: setupIntent.id,
        status: 'succeeded',
        tenantId: setupIntent.metadata?.tenantId,
        userId: setupIntent.metadata?.userId,
        paymentMethodExternalId,
        stripeCustomerId: this.extractCustomerId(setupIntent.customer),
      };
    }

    return null;
  }

  private mapPaymentIntentUpdate(event: { type: string; data: unknown }): PaymentStatusUpdate | null {
    const paymentIntent = this.extractPaymentIntentLike(event.data);

    if (!paymentIntent) {
      return null;
    }

    // Checkout payments are reconciled via checkout.session.*; only auto off-session PIs use this path.
    if (paymentIntent.metadata?.mode !== 'auto') {
      return null;
    }

    const invoiceId = paymentIntent.metadata?.invoiceId;

    if (!invoiceId) {
      return null;
    }

    let status: PaymentStatusUpdate['status'] | null = null;

    if (event.type === 'payment_intent.succeeded') {
      status = 'succeeded';
    } else if (event.type === 'payment_intent.payment_failed') {
      status = 'failed';
    } else if (event.type === 'payment_intent.canceled') {
      status = 'canceled';
    }

    if (!status) {
      return null;
    }

    return {
      invoiceId,
      externalId: paymentIntent.id,
      status,
      amountPaid:
        status === 'succeeded' ? this.minorToMajor(paymentIntent.amount_received ?? paymentIntent.amount) : undefined,
      occurredAt: this.eventTime(event as { created?: number }),
      paymentIntentId: paymentIntent.id,
      tenantId: paymentIntent.metadata?.tenantId,
      userId: paymentIntent.metadata?.userId,
      mode: 'auto',
      paymentMethodExternalId: this.extractPaymentMethodId(paymentIntent.payment_method),
      stripeCustomerId: this.extractCustomerId(paymentIntent.customer),
    };
  }

  private async retrieveCheckoutSessionExpanded(
    sessionId: string,
    expand: string[],
  ): Promise<StripeCheckoutSessionPayload | null> {
    try {
      const retrieved = await this.client().checkout.sessions.retrieve(sessionId, { expand });

      if (!retrieved || typeof retrieved !== 'object') {
        return null;
      }

      return retrieved as unknown as StripeCheckoutSessionPayload;
    } catch (error) {
      this.logger.warn(`Failed to retrieve expanded Stripe checkout session ${sessionId}: ${(error as Error).message}`);

      return null;
    }
  }

  private resolveCheckoutSessionStatus(eventType: string): PaymentStatusUpdate['status'] | null {
    switch (eventType) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return 'succeeded';
      case 'checkout.session.async_payment_failed':
        return 'failed';
      case 'checkout.session.expired':
        return 'canceled';
      default:
        return null;
    }
  }

  private extractCheckoutSession(data: unknown): StripeCheckoutSessionPayload | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const envelope = data as { object?: StripeCheckoutSessionPayload };

    if (envelope.object && typeof envelope.object === 'object') {
      return envelope.object;
    }

    return data as StripeCheckoutSessionPayload;
  }

  private extractPaymentIntentLike(data: unknown): StripePaymentIntentPayload | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const envelope = data as { object?: StripePaymentIntentPayload };

    if (envelope.object && typeof envelope.object === 'object') {
      return envelope.object;
    }

    return data as StripePaymentIntentPayload;
  }

  private extractCustomerId(customer: string | { id?: string } | null | undefined): string | undefined {
    if (!customer) {
      return undefined;
    }

    if (typeof customer === 'string') {
      return customer;
    }

    return customer.id;
  }

  private extractPaymentMethodId(paymentMethod: string | { id?: string } | null | undefined): string | undefined {
    if (!paymentMethod) {
      return undefined;
    }

    if (typeof paymentMethod === 'string') {
      return paymentMethod;
    }

    return paymentMethod.id;
  }

  private extractPaymentMethodFromSession(session: StripeCheckoutSessionPayload): string | undefined {
    const fromPaymentIntent =
      session.payment_intent && typeof session.payment_intent === 'object'
        ? this.extractPaymentMethodId(session.payment_intent.payment_method)
        : undefined;

    if (fromPaymentIntent) {
      return fromPaymentIntent;
    }

    if (session.setup_intent && typeof session.setup_intent === 'object') {
      return this.extractPaymentMethodId(session.setup_intent.payment_method);
    }

    return undefined;
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    const paymentIntentId = await this.resolvePaymentIntentId(params.externalCheckoutSessionId);
    const refund = await this.client().refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: Math.round(params.amount * 100),
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return { externalRefundId: refund.id };
  }

  /** Auto charges store the PaymentIntent id, checkout payments the session id. */
  private async resolvePaymentIntentId(externalId: string): Promise<string> {
    if (externalId.startsWith('pi_')) {
      return externalId;
    }

    const session = await this.client().checkout.sessions.retrieve(externalId, { expand: ['payment_intent'] });
    const paymentIntent = session.payment_intent;

    if (!paymentIntent) {
      throw new Error('Stripe checkout session has no payment intent');
    }

    return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
  }

  async listBalanceTransactions(
    params: ListBalanceTransactionsParams,
  ): Promise<{ items: ProcessorBalanceTransaction[]; hasMore: boolean }> {
    const page = await this.client().balanceTransactions.list({
      limit: Math.min(Math.max(params.limit, 1), 100),
      ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
      ...(params.createdAfter ? { created: { gt: Math.floor(params.createdAfter.getTime() / 1000) } } : {}),
      expand: ['data.source'],
    });
    const items = page.data.map((bt) => {
      const source =
        bt.source && typeof bt.source === 'object' ? (bt.source as unknown as Record<string, unknown>) : null;
      const metadata = (source?.['metadata'] ?? {}) as Record<string, string | undefined>;
      const paymentIntent = source?.['payment_intent'];

      return {
        id: bt.id,
        type: bt.type,
        reportingCategory: bt.reporting_category,
        amount: bt.amount / 100,
        fee: bt.fee / 100,
        net: bt.net / 100,
        currency: bt.currency.toUpperCase(),
        created: new Date(bt.created * 1000),
        availableOn: bt.available_on ? new Date(bt.available_on * 1000) : undefined,
        sourceId: typeof bt.source === 'string' ? bt.source : (source?.['id'] as string | undefined),
        paymentIntentId:
          typeof paymentIntent === 'string'
            ? paymentIntent
            : paymentIntent && typeof paymentIntent === 'object'
              ? ((paymentIntent as { id?: string }).id ?? undefined)
              : undefined,
        invoiceId: metadata['invoiceId'],
        payoutId: bt.type === 'payout' ? (source?.['id'] as string | undefined) : undefined,
        description: bt.description ?? undefined,
      } satisfies ProcessorBalanceTransaction;
    });

    return { items, hasMore: page.has_more };
  }
}
