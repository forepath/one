import { enqueueUnitJob } from '@forepath/shared/backend/util-queue';

import { WEBHOOK_DELIVER_JOB_NAME } from '../constants/notification.constants';

import { NotificationDispatcherService } from './notification-dispatcher.service';

jest.mock('@forepath/shared/backend/util-queue', () => ({
  enqueueUnitJob: jest.fn().mockResolvedValue(undefined),
}));

describe('NotificationDispatcherService', () => {
  const options = {
    applicationId: 'decabill',
    eventCatalog: ['invoice.issued'],
    scopeMode: 'tenant_id' as const,
    controllerPath: 'admin/billing/webhooks',
    queueName: 'billing',
    resolveScopeKey: () => 'tenant-a',
    assertAdmin: () => undefined,
  };

  const endpointsRepository = {
    findMatchingForDispatch: jest.fn(),
  };

  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  const enqueueUnitJobMock = enqueueUnitJob as jest.MockedFunction<typeof enqueueUnitJob>;

  let service: NotificationDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationDispatcherService(endpointsRepository as never, options, queue as never);
  });

  it('enqueues delivery jobs only for matching enabled endpoints in scope', async () => {
    endpointsRepository.findMatchingForDispatch.mockResolvedValue([
      { id: 'endpoint-1', clientId: null, enabled: true },
      { id: 'endpoint-2', clientId: 'client-b', enabled: true },
    ]);

    await service.publish({
      type: 'invoice.issued',
      scopeKey: 'tenant-a',
      clientId: 'client-a',
      data: { invoiceId: 'inv-1' },
    });

    expect(endpointsRepository.findMatchingForDispatch).toHaveBeenCalledWith('tenant-a', 'invoice.issued');
    expect(enqueueUnitJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueUnitJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queue,
        jobName: WEBHOOK_DELIVER_JOB_NAME,
        payload: expect.objectContaining({
          endpointId: 'endpoint-1',
          scopeKey: 'tenant-a',
          clientId: 'client-a',
          attempt: 1,
        }),
      }),
    );
  });

  it('includes tenant_id in envelope for tenant-scoped applications', () => {
    const envelope = service.buildEnvelope({
      type: 'invoice.issued',
      scopeKey: 'tenant-a',
      data: { invoiceId: 'inv-1' },
    });

    expect(envelope.tenant_id).toBe('tenant-a');
    expect(envelope.application).toBe('decabill');
    expect(envelope.data.object).toEqual({ invoiceId: 'inv-1' });
  });

  it('omits tenant_id for instance-scoped applications', () => {
    const instanceService = new NotificationDispatcherService(
      endpointsRepository as never,
      { ...options, scopeMode: 'instance', applicationId: 'agenstra' },
      queue as never,
    );

    const envelope = instanceService.buildEnvelope({
      type: 'ticket.created',
      scopeKey: 'instance',
      clientId: 'client-a',
      data: { ticketId: 't-1' },
    });

    expect(envelope.tenant_id).toBeNull();
    expect(envelope.client_id).toBe('client-a');
  });

  it('does not enqueue when no endpoints match client filter', async () => {
    endpointsRepository.findMatchingForDispatch.mockResolvedValue([
      { id: 'endpoint-2', clientId: 'client-b', enabled: true },
    ]);

    await service.publish({
      type: 'ticket.updated',
      scopeKey: 'instance',
      clientId: 'client-a',
      data: { ticketId: 't-1' },
    });

    expect(enqueueUnitJobMock).not.toHaveBeenCalled();
  });

  it('throttles high-volume chat events using time buckets', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(120_000);
    endpointsRepository.findMatchingForDispatch.mockResolvedValue([{ id: 'endpoint-1', clientId: 'client-a' }]);

    await service.publish({
      type: 'chat_message.created',
      scopeKey: 'instance',
      clientId: 'client-a',
      data: { message: 'hello' },
    });

    expect(enqueueUnitJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobIdParts: ['chat_message.created', 'endpoint-1', 'client-a', 2],
      }),
    );
  });
});
