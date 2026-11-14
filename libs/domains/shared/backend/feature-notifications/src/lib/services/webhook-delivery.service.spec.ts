import { recordSharedCounter, recordSharedHistogram } from '@forepath/shared/backend/util-otel';

import { WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD } from '../constants/notification.constants';
import type { NotificationEventEnvelope } from '../interfaces/notification.interfaces';

import { WebhookDeliveryService } from './webhook-delivery.service';

jest.mock('@forepath/shared/backend/util-otel', () => ({
  httpStatusClass: (status: number | null | undefined) => {
    if (status === null || status === undefined) {
      return 'none';
    }

    if (status >= 200 && status < 300) {
      return '2xx';
    }

    if (status >= 500) {
      return '5xx';
    }

    return 'other';
  },
  recordSharedCounter: jest.fn(),
  recordSharedHistogram: jest.fn(),
}));

const mockedRecordSharedCounter = recordSharedCounter as jest.MockedFunction<typeof recordSharedCounter>;
const mockedRecordSharedHistogram = recordSharedHistogram as jest.MockedFunction<typeof recordSharedHistogram>;

describe('WebhookDeliveryService', () => {
  const envelope: NotificationEventEnvelope = {
    id: 'event-1',
    object: 'event',
    type: 'invoice.issued',
    created: '2026-07-14T12:00:00.000Z',
    api_version: '2026-07',
    application: 'decabill',
    tenant_id: 'tenant-a',
    client_id: null,
    data: { object: { invoiceId: 'inv-1' } },
  };
  const endpoint = {
    id: 'endpoint-1',
    scopeKey: 'tenant-a',
    url: 'https://example.com/hook',
    httpMethod: 'POST',
    authType: 'none',
    authValue: null,
    authHeaderName: null,
    signingSecret: 'secret',
    enabled: true,
    consecutiveFailures: 0,
    disabledReason: null,
  };
  const endpointsRepository = {
    findByIdAndScope: jest.fn(),
    save: jest.fn(),
  };
  const deliveriesRepository = {
    create: jest.fn(),
  };
  const httpClient = {
    deliver: jest.fn(),
  };
  const signatureService = {
    sign: jest.fn().mockReturnValue('sig-header'),
  };
  const deliveryRetentionService = {
    applyRetentionForEndpointFireAndForget: jest.fn(),
  };
  let service: WebhookDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    endpointsRepository.findByIdAndScope.mockResolvedValue({ ...endpoint });
    deliveriesRepository.create.mockResolvedValue({
      id: 'delivery-1',
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      payload: envelope,
      httpStatus: 200,
      responseBody: 'ok',
      success: true,
      attempt: 1,
      errorMessage: null,
      createdAt: new Date(),
    });
    service = new WebhookDeliveryService(
      endpointsRepository as never,
      deliveriesRepository as never,
      httpClient as never,
      signatureService as never,
      deliveryRetentionService as never,
    );
  });

  it('delivers signed payload and logs success', async () => {
    httpClient.deliver.mockResolvedValue({
      httpStatus: 200,
      responseBody: 'ok',
      success: true,
    });

    await service.deliver({
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      scopeKey: 'tenant-a',
      envelope,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(endpointsRepository.findByIdAndScope).toHaveBeenCalledTimes(2);
    expect(signatureService.sign).toHaveBeenCalled();
    expect(deliveriesRepository.create).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, success: true }));
    expect(deliveryRetentionService.applyRetentionForEndpointFireAndForget).toHaveBeenCalledWith(endpoint);
    expect(endpointsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ consecutiveFailures: 0 }));
    expect(mockedRecordSharedCounter).toHaveBeenCalledWith(
      'notifications.delivery.attempts_total',
      expect.objectContaining({ channel: 'webhook', outcome: 'success', http_status_class: '2xx' }),
    );
    expect(mockedRecordSharedHistogram).toHaveBeenCalledWith(
      'notifications.delivery.duration_ms',
      expect.any(Number),
      expect.objectContaining({ channel: 'webhook', outcome: 'success' }),
    );
  });

  it('throws on HTTP failure so BullMQ can retry without incrementing consecutive failures', async () => {
    httpClient.deliver.mockResolvedValue({
      httpStatus: 500,
      responseBody: 'error',
      success: false,
      errorMessage: 'HTTP 500',
    });
    deliveriesRepository.create.mockResolvedValue({
      id: 'delivery-2',
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      payload: envelope,
      httpStatus: 500,
      responseBody: 'error',
      success: false,
      attempt: 1,
      errorMessage: 'HTTP 500',
      createdAt: new Date(),
    });

    await expect(
      service.deliver({
        endpointId: 'endpoint-1',
        eventId: 'event-1',
        eventType: 'invoice.issued',
        scopeKey: 'tenant-a',
        envelope,
        attempt: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('HTTP 500');

    expect(endpointsRepository.save).not.toHaveBeenCalled();
  });

  it('increments failures and auto-disables endpoint after final failed attempt', async () => {
    const failingEndpoint = {
      ...endpoint,
      consecutiveFailures: WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD - 1,
    };

    endpointsRepository.findByIdAndScope.mockResolvedValue(failingEndpoint);
    httpClient.deliver.mockResolvedValue({
      httpStatus: 500,
      responseBody: 'error',
      success: false,
      errorMessage: 'HTTP 500',
    });
    deliveriesRepository.create.mockResolvedValue({
      id: 'delivery-2',
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      payload: envelope,
      httpStatus: 500,
      responseBody: 'error',
      success: false,
      attempt: 3,
      errorMessage: 'HTTP 500',
      createdAt: new Date(),
    });

    await expect(
      service.deliver({
        endpointId: 'endpoint-1',
        eventId: 'event-1',
        eventType: 'invoice.issued',
        scopeKey: 'tenant-a',
        envelope,
        attempt: 3,
        maxAttempts: 3,
      }),
    ).rejects.toThrow('HTTP 500');

    expect(endpointsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        consecutiveFailures: WEBHOOK_CONSECUTIVE_FAILURE_DISABLE_THRESHOLD,
      }),
    );
    expect(mockedRecordSharedCounter).toHaveBeenCalledWith('notifications.delivery.auto_disabled_total', {
      channel: 'webhook',
    });
  });

  it('returns failed test delivery without throwing or updating endpoint counters', async () => {
    httpClient.deliver.mockResolvedValue({
      httpStatus: 500,
      responseBody: 'error',
      success: false,
      errorMessage: 'HTTP 500',
    });
    deliveriesRepository.create.mockResolvedValue({
      id: 'delivery-test',
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      payload: envelope,
      httpStatus: 500,
      responseBody: 'error',
      success: false,
      attempt: 1,
      errorMessage: 'HTTP 500',
      createdAt: new Date(),
    });

    const result = await service.sendTest('endpoint-1', 'tenant-a', envelope);

    expect(result.success).toBe(false);
    expect(endpointsRepository.save).not.toHaveBeenCalled();
  });

  it('skips delivery when endpoint is outside scope', async () => {
    endpointsRepository.findByIdAndScope.mockResolvedValue(null);

    const result = await service.deliver({
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      scopeKey: 'tenant-b',
      envelope,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Endpoint unavailable');
    expect(httpClient.deliver).not.toHaveBeenCalled();
    expect(deliveriesRepository.create).not.toHaveBeenCalled();
  });

  it('skips delivery log when endpoint is deleted during delivery', async () => {
    endpointsRepository.findByIdAndScope.mockResolvedValueOnce({ ...endpoint }).mockResolvedValueOnce(null);
    httpClient.deliver.mockResolvedValue({
      httpStatus: 200,
      responseBody: 'ok',
      success: true,
    });

    const result = await service.deliver({
      endpointId: 'endpoint-1',
      eventId: 'event-1',
      eventType: 'invoice.issued',
      scopeKey: 'tenant-a',
      envelope,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(httpClient.deliver).toHaveBeenCalled();
    expect(deliveriesRepository.create).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(endpointsRepository.save).not.toHaveBeenCalled();
  });
});
