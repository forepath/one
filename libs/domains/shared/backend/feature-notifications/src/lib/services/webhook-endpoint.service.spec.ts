import { BadRequestException } from '@nestjs/common';

import { WebhookAuthType, WebhookHttpMethod } from '../entities/webhook-endpoint.entity';
import { WebhookEndpointService } from './webhook-endpoint.service';

describe('WebhookEndpointService', () => {
  const options = {
    applicationId: 'decabill',
    eventCatalog: ['invoice.issued', 'invoice.created'],
    scopeMode: 'tenant_id' as const,
    controllerPath: 'admin/billing/webhooks',
    queueName: 'billing',
    resolveScopeKey: () => 'tenant-a',
    assertAdmin: () => undefined,
  };

  const endpointsRepository = {
    findAllByScope: jest.fn(),
    findByIdAndScope: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const deliveriesRepository = {
    deleteAllByEndpointId: jest.fn(),
  };

  const deliveryRetentionService = {
    applyRetentionForEndpointFireAndForget: jest.fn(),
  };

  let service: WebhookEndpointService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookEndpointService(
      endpointsRepository as never,
      deliveriesRepository as never,
      deliveryRetentionService as never,
      options,
    );
  });

  it('creates endpoint in current scope', async () => {
    endpointsRepository.create.mockResolvedValue({
      id: 'endpoint-1',
      scopeKey: 'tenant-a',
      name: 'Primary',
      url: 'https://example.com/hook',
      httpMethod: WebhookHttpMethod.POST,
      subscribedEvents: ['invoice.issued'],
      enabled: true,
      authType: WebhookAuthType.NONE,
      consecutiveFailures: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.create({
      name: 'Primary',
      url: 'https://example.com/hook',
      httpMethod: WebhookHttpMethod.POST,
      subscribedEvents: ['invoice.issued'],
      authType: WebhookAuthType.NONE,
    });

    expect(endpointsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ scopeKey: 'tenant-a', name: 'Primary' }),
    );
    expect(result.signingSecret).toBeDefined();
  });

  it('rejects unsupported event types', async () => {
    await expect(
      service.create({
        name: 'Primary',
        url: 'https://example.com/hook',
        httpMethod: WebhookHttpMethod.POST,
        subscribedEvents: ['unknown.event'],
        authType: WebhookAuthType.NONE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows localhost webhook URLs in development', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    endpointsRepository.create.mockResolvedValue({
      id: 'endpoint-1',
      scopeKey: 'tenant-a',
      name: 'Local',
      url: 'http://localhost:4242/webhook',
      httpMethod: WebhookHttpMethod.POST,
      subscribedEvents: ['invoice.issued'],
      enabled: true,
      authType: WebhookAuthType.NONE,
      consecutiveFailures: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    try {
      await service.create({
        name: 'Local',
        url: 'http://localhost:4242/webhook',
        httpMethod: WebhookHttpMethod.POST,
        subscribedEvents: ['invoice.issued'],
        authType: WebhookAuthType.NONE,
      });

      expect(endpointsRepository.create).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('returns not found when endpoint is outside current scope', async () => {
    endpointsRepository.findByIdAndScope.mockResolvedValue(null);

    await expect(service.get('endpoint-1')).rejects.toThrow('Webhook endpoint not found');
  });

  it('rejects GET webhooks for sensitive subscribed events', async () => {
    await expect(
      service.create({
        name: 'Invoice hook',
        url: 'https://example.com/hook',
        httpMethod: WebhookHttpMethod.GET,
        subscribedEvents: ['invoice.issued'],
        authType: WebhookAuthType.NONE,
      }),
    ).rejects.toThrow('GET webhooks cannot subscribe to sensitive event types');
  });

  it('rejects webhook URLs with embedded credentials', async () => {
    await expect(
      service.create({
        name: 'Bad URL',
        url: 'https://user:pass@example.com/hook',
        httpMethod: WebhookHttpMethod.POST,
        subscribedEvents: ['invoice.issued'],
        authType: WebhookAuthType.NONE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('triggers retention pruning when retention settings are updated', async () => {
    const entity = {
      id: 'endpoint-1',
      scopeKey: 'tenant-a',
      name: 'Primary',
      url: 'https://example.com/hook',
      httpMethod: WebhookHttpMethod.POST,
      subscribedEvents: ['invoice.issued'],
      enabled: true,
      authType: WebhookAuthType.NONE,
      consecutiveFailures: 0,
      deliveryLogRetentionDays: 30,
      deliveryLogMaxEntries: 500,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    endpointsRepository.findByIdAndScope.mockResolvedValue(entity);
    endpointsRepository.save.mockResolvedValue({ ...entity, deliveryLogRetentionDays: 7 });

    await service.update('endpoint-1', { deliveryLogRetentionDays: 7 });

    expect(deliveryRetentionService.applyRetentionForEndpointFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'endpoint-1', deliveryLogRetentionDays: 7 }),
    );
  });

  it('deletes delivery logs before removing endpoint', async () => {
    const entity = {
      id: 'endpoint-1',
      scopeKey: 'tenant-a',
      name: 'Primary',
      url: 'https://example.com/hook',
      httpMethod: WebhookHttpMethod.POST,
      subscribedEvents: ['invoice.issued'],
      enabled: true,
      authType: WebhookAuthType.NONE,
      consecutiveFailures: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    endpointsRepository.findByIdAndScope.mockResolvedValue(entity);
    deliveriesRepository.deleteAllByEndpointId.mockResolvedValue(12);

    await service.delete('endpoint-1');

    expect(deliveriesRepository.deleteAllByEndpointId).toHaveBeenCalledWith('endpoint-1');
    expect(endpointsRepository.delete).toHaveBeenCalledWith(entity);
  });
});
