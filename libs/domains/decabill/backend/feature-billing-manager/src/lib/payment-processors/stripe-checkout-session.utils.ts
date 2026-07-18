import { CreateCheckoutSessionParams, CreateSetupSessionParams } from './payment-processor.interface';

export interface StripeCheckoutSessionBuildOptions {
  fraudProtectionEnabled: boolean;
}

export function buildStripeCheckoutSessionCreateParams(
  params: CreateCheckoutSessionParams,
  options: StripeCheckoutSessionBuildOptions,
) {
  return {
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
    payment_intent_data: {
      setup_future_usage: 'off_session' as const,
      metadata: params.metadata,
    },
    ...(params.stripeCustomerId
      ? { customer: params.stripeCustomerId }
      : params.customerEmail
        ? { customer_email: params.customerEmail }
        : {}),
    ...(options.fraudProtectionEnabled
      ? {
          payment_method_options: {
            card: {
              request_three_d_secure: 'automatic' as const,
            },
          },
        }
      : {}),
  };
}

export function buildStripeSetupSessionCreateParams(params: CreateSetupSessionParams) {
  return {
    mode: 'setup' as const,
    currency: params.currency.toLowerCase(),
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata,
    setup_intent_data: {
      metadata: params.metadata,
    },
    ...(params.stripeCustomerId
      ? { customer: params.stripeCustomerId }
      : params.customerEmail
        ? { customer_email: params.customerEmail }
        : {}),
  };
}
