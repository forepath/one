import { assertProductionWebhookEscapeHatchesDisabled, assertSafeWebhookUrlOrThrow } from './webhook-endpoint-security';

describe('assertSafeWebhookUrlOrThrow', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.WEBHOOK_ALLOW_INTERNAL_HOST;
    delete process.env.WEBHOOK_ALLOW_INSECURE_HTTP;
  });

  it('allows localhost over https in development', () => {
    process.env.NODE_ENV = 'development';

    expect(() => assertSafeWebhookUrlOrThrow('https://localhost:4242/webhook')).not.toThrow();
  });

  it('rejects localhost in production', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertSafeWebhookUrlOrThrow('https://localhost:4242/webhook')).toThrow(
      'Webhook URL must not target private or loopback addresses',
    );
  });

  it('rejects http in production', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertSafeWebhookUrlOrThrow('http://example.com/hook')).toThrow('Webhook URL must use HTTPS');
  });

  it('rejects embedded credentials', () => {
    process.env.NODE_ENV = 'development';

    expect(() => assertSafeWebhookUrlOrThrow('https://user:pass@example.com/hook')).toThrow(
      'Webhook URL must not contain username/password',
    );
  });

  it('rejects literal private IPv4 addresses', () => {
    process.env.NODE_ENV = 'production';

    expect(() => assertSafeWebhookUrlOrThrow('https://192.168.1.10/hook')).toThrow(
      'Webhook URL must not target private or loopback addresses',
    );
  });
});

describe('assertProductionWebhookEscapeHatchesDisabled', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalExit = process.exit;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.WEBHOOK_ALLOW_INTERNAL_HOST;
    delete process.env.WEBHOOK_ALLOW_INSECURE_HTTP;
    process.exit = originalExit;
  });

  it('exits when internal host bypass is enabled in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_ALLOW_INTERNAL_HOST = 'true';
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    assertProductionWebhookEscapeHatchesDisabled();

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
