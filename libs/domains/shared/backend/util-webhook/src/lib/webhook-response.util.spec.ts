import { truncateWebhookResponseBody, WEBHOOK_MAX_RESPONSE_BODY_CHARS } from './webhook-response.util';

describe('truncateWebhookResponseBody', () => {
  it('returns null for nullish input', () => {
    expect(truncateWebhookResponseBody(null)).toBeNull();
    expect(truncateWebhookResponseBody(undefined)).toBeNull();
  });

  it('truncates oversized bodies', () => {
    const body = 'x'.repeat(WEBHOOK_MAX_RESPONSE_BODY_CHARS + 10);
    const truncated = truncateWebhookResponseBody(body);

    expect(truncated).toContain('[truncated]');
    expect(truncated!.length).toBeLessThanOrEqual(WEBHOOK_MAX_RESPONSE_BODY_CHARS + 20);
  });
});
