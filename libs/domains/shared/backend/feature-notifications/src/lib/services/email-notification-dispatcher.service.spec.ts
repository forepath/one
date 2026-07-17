import {
  EMAIL_DELIVER_JOB_NAME,
  EMAIL_DELIVER_MAX_ATTEMPTS,
  EMAIL_DELIVER_REMOVE_ON_COMPLETE,
  EMAIL_DELIVER_REMOVE_ON_FAIL,
} from '../constants/notification.constants';
import { EmailNotificationDispatcherService } from './email-notification-dispatcher.service';

describe('EmailNotificationDispatcherService', () => {
  const queue = { add: jest.fn() };
  const emailService = { isEnabled: jest.fn().mockReturnValue(true) };
  const options = {
    applicationId: 'decabill',
    eventCatalog: [],
    scopeMode: 'tenant_id' as const,
    controllerPath: 'admin/webhooks',
    queueName: 'billing',
    resolveScopeKey: () => 'default',
    assertAdmin: () => undefined,
    email: {
      templateRoots: ['/tmp'],
      emailEventCatalog: ['invoice.issued', 'user.password_reset_requested'],
      subjectRegistry: {
        'invoice-issued': 'Your invoice is ready',
        'password-reset': 'Reset your password',
      },
    },
  };

  beforeEach(() => {
    queue.add.mockReset().mockResolvedValue(undefined);
    emailService.isEnabled.mockReturnValue(true);
  });

  it('enqueues email-deliver when SMTP is enabled', async () => {
    const service = new EmailNotificationDispatcherService(options, queue as never, emailService as never);

    await service.publish({
      eventType: 'invoice.issued',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'invoice-issued',
      templateContext: { invoiceNumber: 'INV-1' },
    });

    expect(queue.add).toHaveBeenCalledWith(
      EMAIL_DELIVER_JOB_NAME,
      expect.objectContaining({
        eventType: 'invoice.issued',
        to: 'a@example.com',
        templateKey: 'invoice-issued',
        templateContext: { invoiceNumber: 'INV-1' },
      }),
      expect.objectContaining({
        attempts: EMAIL_DELIVER_MAX_ATTEMPTS,
        removeOnComplete: EMAIL_DELIVER_REMOVE_ON_COMPLETE,
        removeOnFail: EMAIL_DELIVER_REMOVE_ON_FAIL,
      }),
    );
  });

  it('encrypts sensitive context fields out of the Redis payload', async () => {
    const service = new EmailNotificationDispatcherService(options, queue as never, emailService as never);

    await service.publish({
      eventType: 'user.password_reset_requested',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'password-reset',
      templateContext: { code: 'OTP-SECRET', expiryText: '1 hour' },
    });

    const payload = queue.add.mock.calls[0][1] as {
      templateContext: Record<string, unknown>;
      encryptedTemplateSecrets?: string;
    };

    expect(payload.templateContext).toEqual({ expiryText: '1 hour' });
    expect(payload.templateContext.code).toBeUndefined();
    expect(payload.encryptedTemplateSecrets).toEqual(expect.any(String));
    expect(payload.encryptedTemplateSecrets).not.toContain('OTP-SECRET');
  });

  it('rejects event types that are not allowlisted', async () => {
    const service = new EmailNotificationDispatcherService(options, queue as never, emailService as never);

    await expect(
      service.publish({
        eventType: 'invoice.forged',
        scopeKey: 'default',
        to: 'a@example.com',
        templateKey: 'invoice-issued',
        templateContext: {},
      }),
    ).rejects.toThrow('Email event type is not allowlisted');

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('skips enqueue when SMTP is disabled', async () => {
    emailService.isEnabled.mockReturnValue(false);
    const service = new EmailNotificationDispatcherService(options, queue as never, emailService as never);

    await service.publish({
      eventType: 'invoice.issued',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'invoice-issued',
      templateContext: {},
    });

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('publishFireAndForget swallows enqueue errors', async () => {
    const { Logger } = await import('@nestjs/common');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    queue.add.mockRejectedValueOnce(new Error('redis down'));
    const service = new EmailNotificationDispatcherService(options, queue as never, emailService as never);

    service.publishFireAndForget({
      eventType: 'invoice.issued',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'invoice-issued',
      templateContext: {},
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to enqueue email'));
    warnSpy.mockRestore();
  });
});
