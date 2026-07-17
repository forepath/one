import { createJsonAes256GcmTransformer } from '@shared/backend/util-crypto';

import { EmailDeliveryService } from './email-delivery.service';

describe('EmailDeliveryService', () => {
  const emailService = {
    sendOrThrow: jest.fn().mockResolvedValue(undefined),
  };
  const templateRenderer = {
    render: jest.fn().mockReturnValue({ html: '<p>Hi</p>', text: 'Hi' }),
  };
  const deliveriesRepository = {
    create: jest.fn().mockResolvedValue({ id: 'd1' }),
  };
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
      resolveCompanyName: () => 'Acme GmbH',
      resolveCompanyFrom: () => ({
        name: 'Acme GmbH',
        lines: ['Main St 1'],
        email: 'billing@acme.example',
      }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders, sends, and logs success with lazy company branding', async () => {
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      null,
    );

    await service.deliver({
      eventId: 'e1',
      eventType: 'invoice.issued',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'invoice-issued',
      templateContext: { invoiceNumber: 'INV-1', code: 'SECRET' },
      attempt: 1,
      maxAttempts: 3,
    });

    expect(templateRenderer.render).toHaveBeenCalledWith(
      ['/tmp'],
      'invoice-issued',
      expect.objectContaining({
        invoiceNumber: 'INV-1',
        code: 'SECRET',
        companyName: 'Acme GmbH',
        companyFrom: {
          name: 'Acme GmbH',
          lines: ['Main St 1'],
          email: 'billing@acme.example',
        },
      }),
    );
    expect(emailService.sendOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@example.com',
        subject: 'Your invoice is ready',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    );
    expect(deliveriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        templateContext: { invoiceNumber: 'INV-1' },
      }),
    );
  });

  it('unseals encrypted secrets before render and strips them from delivery logs', async () => {
    const encryptedTemplateSecrets = createJsonAes256GcmTransformer().to({ code: 'OTP-SECRET' }) as string;
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      null,
    );

    await service.deliver({
      eventId: 'e1',
      eventType: 'user.password_reset_requested',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'password-reset',
      templateContext: { expiryText: '1 hour' },
      encryptedTemplateSecrets,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(templateRenderer.render).toHaveBeenCalledWith(
      ['/tmp'],
      'password-reset',
      expect.objectContaining({
        expiryText: '1 hour',
        code: 'OTP-SECRET',
      }),
    );
    expect(deliveriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateContext: { expiryText: '1 hour' },
      }),
    );
  });

  it('resolves and attaches documents via injected EMAIL_ATTACHMENT_RESOLVER', async () => {
    const pdf = Buffer.from('pdf');
    const attachmentResolver = {
      resolve: jest.fn().mockResolvedValue([{ filename: 'INV-1.pdf', content: pdf }]),
    };

    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      attachmentResolver as never,
    );

    await service.deliver({
      eventId: 'e1',
      eventType: 'invoice.issued',
      scopeKey: 'default',
      to: 'a@example.com',
      templateKey: 'invoice-issued',
      templateContext: { invoiceNumber: 'INV-1' },
      attachments: [{ storageKey: 'sub/inv.pdf', filename: 'INV-1.pdf' }],
      attempt: 1,
      maxAttempts: 3,
    });

    expect(attachmentResolver.resolve).toHaveBeenCalledWith([{ storageKey: 'sub/inv.pdf', filename: 'INV-1.pdf' }]);
    expect(emailService.sendOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ filename: 'INV-1.pdf', content: pdf }],
      }),
    );
  });

  it('fails when attachments are present but resolver is missing', async () => {
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      null,
    );

    await expect(
      service.deliver({
        eventId: 'e1',
        eventType: 'invoice.issued',
        scopeKey: 'default',
        to: 'a@example.com',
        templateKey: 'invoice-issued',
        templateContext: {},
        attachments: [{ storageKey: 'sub/inv.pdf', filename: 'INV-1.pdf' }],
        attempt: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('EMAIL_ATTACHMENT_RESOLVER is not registered');
  });

  it('rejects delivery for non-allowlisted template keys', async () => {
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      null,
    );

    await expect(
      service.deliver({
        eventId: 'e1',
        eventType: 'invoice.issued',
        scopeKey: 'default',
        to: 'a@example.com',
        templateKey: '../etc/passwd',
        templateContext: {},
        attempt: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('Invalid email template key');
  });

  it('logs failure and rethrows for BullMQ retry', async () => {
    emailService.sendOrThrow.mockRejectedValueOnce(new Error('SMTP down'));
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      null,
    );

    await expect(
      service.deliver({
        eventId: 'e1',
        eventType: 'invoice.issued',
        scopeKey: 'default',
        to: 'a@example.com',
        templateKey: 'invoice-issued',
        templateContext: {},
        attempt: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('SMTP down');

    expect(deliveriesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorMessage: 'SMTP down' }),
    );
  });
});
