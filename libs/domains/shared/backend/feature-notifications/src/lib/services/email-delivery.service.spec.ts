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
      emailEventCatalog: ['invoice.issued'],
      subjectRegistry: {
        'invoice-issued': 'Your invoice is ready',
      },
      companyName: 'Acme GmbH',
      companyFrom: {
        name: 'Acme GmbH',
        lines: ['Main St 1'],
        email: 'billing@acme.example',
      },
    },
  };
  const moduleRef = {
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    moduleRef.get.mockImplementation(() => {
      throw new Error('not found');
    });
  });

  it('renders, sends, and logs success', async () => {
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      moduleRef as never,
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

  it('resolves and attaches documents via EMAIL_ATTACHMENT_RESOLVER', async () => {
    const pdf = Buffer.from('pdf');
    moduleRef.get.mockReturnValue({
      resolve: jest.fn().mockResolvedValue([{ filename: 'INV-1.pdf', content: pdf }]),
    });

    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      moduleRef as never,
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
      moduleRef as never,
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

  it('logs failure and rethrows for BullMQ retry', async () => {
    emailService.sendOrThrow.mockRejectedValueOnce(new Error('SMTP down'));
    const service = new EmailDeliveryService(
      emailService as never,
      templateRenderer as never,
      deliveriesRepository as never,
      options,
      moduleRef as never,
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
