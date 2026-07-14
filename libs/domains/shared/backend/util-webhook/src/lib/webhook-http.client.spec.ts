import { WEBHOOK_MAX_RESPONSE_BODY_CHARS } from './webhook-response.util';
import { WebhookHttpClient } from './webhook-http.client';

describe('WebhookHttpClient', () => {
  const originalFetch = global.fetch;
  const client = new WebhookHttpClient();

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects HTTP redirect responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 302,
      ok: false,
      text: async () => '',
    }) as never;

    const result = await client.deliver({
      url: 'https://example.com/hook',
      method: 'POST',
      auth: { authType: 'none' },
      body: { hello: 'world' },
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('redirects are not allowed');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('truncates large response bodies', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => 'y'.repeat(WEBHOOK_MAX_RESPONSE_BODY_CHARS + 50),
    }) as never;

    const result = await client.deliver({
      url: 'https://example.com/hook',
      method: 'POST',
      auth: { authType: 'none' },
      body: {},
    });

    expect(result.success).toBe(true);
    expect(result.responseBody).toContain('[truncated]');
  });
});
