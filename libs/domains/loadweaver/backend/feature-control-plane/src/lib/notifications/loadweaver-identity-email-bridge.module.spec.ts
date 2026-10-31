import { IDENTITY_EMAIL_DISPATCHER, type IIdentityEmailDispatcher } from '@forepath/identity/backend';
import { EmailNotificationDispatcherService, EmailService, INSTANCE_SCOPE_KEY } from '@forepath/shared/backend';

import { LoadweaverIdentityEmailBridgeModule } from './loadweaver-identity-email-bridge.module';

describe('LoadweaverIdentityEmailBridgeModule', () => {
  const provider = (Reflect.getMetadata('providers', LoadweaverIdentityEmailBridgeModule) as unknown[]).find(
    (p) => (p as { provide?: unknown }).provide === IDENTITY_EMAIL_DISPATCHER,
  ) as {
    useFactory: (d: EmailNotificationDispatcherService, e: EmailService) => IIdentityEmailDispatcher;
    inject: unknown[];
  };
  const emailService = (enabled: boolean) => ({ isEnabled: () => enabled }) as unknown as EmailService;

  it('provides the identity email dispatcher from the shared email dispatcher', () => {
    expect(provider).toBeDefined();
    expect(provider.inject).toEqual([EmailNotificationDispatcherService, EmailService]);
  });

  it('queues identity emails (e.g. login 2FA codes) under the instance scope', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const dispatcher = provider.useFactory(
      { publish } as unknown as EmailNotificationDispatcherService,
      emailService(true),
    );

    await dispatcher.publishEmail({
      eventType: 'user.login_2fa_requested',
      to: 'admin@example.com',
      templateKey: 'login-2fa',
      templateContext: { code: '123456' },
    });

    expect(publish).toHaveBeenCalledWith({
      eventType: 'user.login_2fa_requested',
      scopeKey: INSTANCE_SCOPE_KEY,
      to: 'admin@example.com',
      templateKey: 'login-2fa',
      templateContext: { code: '123456' },
    });
  });

  it('opts in to "email 2FA only with SMTP": reports whether SMTP is configured', () => {
    const publisher = {} as unknown as EmailNotificationDispatcherService;

    expect(provider.useFactory(publisher, emailService(true)).isDeliveryConfigured?.()).toBe(true);
    expect(provider.useFactory(publisher, emailService(false)).isDeliveryConfigured?.()).toBe(false);
  });
});
