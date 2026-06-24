import { Injectable, Logger } from '@nestjs/common';
import StripeCtor from 'stripe';

import {
  CreateCheckoutSessionParams,
  CheckoutSessionResult,
  PaymentProcessor,
  PaymentStatusUpdate,
} from '../payment-processor.interface';

type StripeClient = ReturnType<typeof StripeCtor>;

interface StripeCheckoutSessionPayload {
  id: string;
  metadata?: Record<string, string | undefined>;
  client_reference_id?: string | null;
  amount_total?: number | null;
  payment_status?: string | null;
}

@Injectable()
export class StripePaymentProcessor implements PaymentProcessor {
  private readonly logger = new Logger(StripePaymentProcessor.name);
  private readonly stripe: StripeClient | null;
  private readonly webhookSecret: string;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY ?? '';

    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    this.stripe = secretKey ? new StripeCtor(secretKey) : null;
  }

  getType(): string {
    return 'stripe';
  }

  getDisplayName(): string {
    return 'Stripe';
  }

  private client(): StripeClient {
    if (!this.stripe) {
      throw new Error('Stripe is not configured');
    }

    return this.stripe;
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSessionResult> {
    const sessionParams = {
      mode: 'payment' as const,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.invoiceId,
      metadata: params.metadata,
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            unit_amount: Math.round(params.amount * 100),
            product_data: {
              name: `Invoice ${params.metadata.invoiceNumber ?? params.invoiceId}`,
            },
          },
          quantity: 1,
        },
      ],
      ...(params.stripeCustomerId
        ? { customer: params.stripeCustomerId }
        : params.customerEmail
          ? { customer_email: params.customerEmail }
          : {}),
    };
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

  parseWebhookEvent(rawBody: Buffer | string): { eventId: string; type: string; data: unknown } {
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const parsed = JSON.parse(payload) as { id: string; type: string; data: unknown };

    return { eventId: parsed.id, type: parsed.type, data: parsed.data };
  }

  mapWebhookToPaymentUpdate(event: { type: string; data: unknown }): PaymentStatusUpdate | null {
    const status = this.resolveCheckoutSessionStatus(event.type);

    if (!status) {
      return null;
    }

    const session = this.extractCheckoutSession(event.data);

    if (!session) {
      return null;
    }

    if (event.type === 'checkout.session.completed' && session.payment_status === 'unpaid') {
      return null;
    }

    const invoiceId = session.metadata?.invoiceId ?? session.client_reference_id;

    if (!invoiceId) {
      return null;
    }

    return {
      invoiceId,
      externalId: session.id,
      status,
      amountPaid: status === 'succeeded' && session.amount_total != null ? session.amount_total / 100 : undefined,
      tenantId: session.metadata?.tenantId,
    };
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
}
