import { EMAIL_DELIVER_JOB_NAME, EMAIL_DELIVER_MAX_ATTEMPTS } from '../constants/notification.constants';
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
      emailEventCatalog: ['invoice.issued'],
      subjectRegistry: {},
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
      }),
      expect.objectContaining({ attempts: EMAIL_DELIVER_MAX_ATTEMPTS }),
    );
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
});
