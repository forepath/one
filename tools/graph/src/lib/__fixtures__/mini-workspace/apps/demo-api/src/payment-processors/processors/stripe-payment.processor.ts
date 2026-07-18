export class StripePaymentProcessor {
  parseWebhookEvent() {
    return { eventId: '1', type: 'x', data: {} };
  }
}
