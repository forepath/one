import { NotificationDispatcherService } from '@forepath/shared/backend/feature-notifications';
import { getTenantIdOrDefault } from '@forepath/shared/backend/util-http-context';

import type { InvoiceEntity } from '../entities/invoice.entity';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SubscriptionStatus } from '../entities/subscription.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';

import { BillingNotificationPublisher } from './billing-notification.publisher';

jest.mock('@forepath/shared/backend/util-http-context', () => ({
  ...jest.requireActual('@forepath/shared/backend/util-http-context'),
  getTenantIdOrDefault: jest.fn(),
}));

describe('BillingNotificationPublisher', () => {
  const getTenantIdOrDefaultMock = getTenantIdOrDefault as jest.MockedFunction<typeof getTenantIdOrDefault>;

  beforeEach(() => {
    getTenantIdOrDefaultMock.mockReturnValue('tenant-a');
  });

  it('publishes invoice events with tenant scope and client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new BillingNotificationPublisher(dispatcher);
    const invoice = {
      id: 'inv-1',
      userId: 'user-1',
      status: InvoiceStatus.DRAFT,
      currency: 'EUR',
      totalGross: 100,
      balanceDue: 100,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
    } as InvoiceEntity;

    publisher.publishInvoice('invoice.created', invoice);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'invoice.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: expect.objectContaining({
        id: 'inv-1',
        userId: 'user-1',
        status: InvoiceStatus.DRAFT,
      }),
    });
  });

  it('publishes subscription events with serialized dates', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new BillingNotificationPublisher(dispatcher);
    const subscription = {
      id: 'sub-1',
      number: 'SUB-001',
      planId: 'plan-1',
      userId: 'user-1',
      status: SubscriptionStatus.ACTIVE,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    } as SubscriptionEntity;

    publisher.publishSubscription('subscription.created', subscription);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'subscription.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: expect.objectContaining({
        id: 'sub-1',
        number: 'SUB-001',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-02T10:00:00.000Z',
      }),
    });
  });

  it('publishes project, milestone, time entry, and ticket events with tenant scope', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new BillingNotificationPublisher(dispatcher);

    publisher.publishProject('project.created', {
      id: 'p1',
      userId: 'user-1',
      name: 'Website redesign',
      description: null,
      status: 'active',
      hourlyRateNet: 120,
      targetHours: 40,
      currency: 'EUR',
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    } as never);

    publisher.publishMilestone('milestone.created', 'user-1', {
      id: 'm1',
      projectId: 'p1',
      name: 'Phase 1',
      description: null,
      targetDate: new Date('2026-08-01T00:00:00.000Z'),
      sortOrder: 0,
      lockedAt: null,
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    } as never);

    publisher.publishTimeEntry('time_entry.created', 'user-1', {
      id: 'e1',
      projectId: 'p1',
      ticketId: 't1',
      recordedByUserId: 'admin-1',
      durationMinutes: 60,
      description: 'Implementation',
      startedAt: new Date('2026-07-03T08:00:00.000Z'),
      endedAt: new Date('2026-07-03T09:00:00.000Z'),
      invoiceId: null,
      billedAt: null,
      createdAt: new Date('2026-07-03T09:00:00.000Z'),
    } as never);

    publisher.publishTicket('ticket.created', 'user-1', {
      id: 't1',
      projectId: 'p1',
      parentId: null,
      milestoneId: 'm1',
      title: 'Homepage',
      status: 'todo',
      priority: 'medium',
      locked: false,
      createdByUserId: 'admin-1',
      createdAt: new Date('2026-07-01T10:00:00.000Z'),
      updatedAt: new Date('2026-07-02T10:00:00.000Z'),
    } as never);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'project.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: expect.objectContaining({
        id: 'p1',
        name: 'Website redesign',
      }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'milestone.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: expect.objectContaining({
        id: 'm1',
        projectId: 'p1',
      }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'time_entry.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: expect.objectContaining({
        id: 'e1',
        durationMinutes: 60,
      }),
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'ticket.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: expect.objectContaining({
        id: 't1',
        title: 'Homepage',
      }),
    });
  });

  it('publishes ticket comment events without user email', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new BillingNotificationPublisher(dispatcher);

    publisher.publishTicketComment('user-1', 'project-1', {
      id: 'comment-1',
      ticketId: 'ticket-1',
      userId: 'admin-1',
      userEmail: 'admin@example.com',
      body: 'Looks good',
      createdAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'ticket.comment.created',
      scopeKey: 'tenant-a',
      clientId: 'user-1',
      data: {
        id: 'comment-1',
        ticketId: 'ticket-1',
        projectId: 'project-1',
        userId: 'admin-1',
        body: 'Looks good',
        createdAt: '2026-07-01T11:00:00.000Z',
      },
    });
  });

  it('publishes DATEV export events without client id', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new BillingNotificationPublisher(dispatcher);

    publisher.publishDatevExport('datev_export.completed', {
      id: 'exp-1',
      scope: 'tenant',
      tenantId: 'default',
      periodYear: 2026,
      periodMonth: 6,
      status: 'completed',
      fileName: 'datev-export-2026-06.zip',
      bookingCount: 12,
      invoiceCount: 4,
      debtorCount: 3,
      includedTenantIds: ['default'],
      triggeredBy: 'scheduler',
      startedAt: new Date('2026-07-01T08:00:00.000Z'),
      completedAt: new Date('2026-07-01T08:05:00.000Z'),
      createdAt: new Date('2026-07-01T08:00:00.000Z'),
      updatedAt: new Date('2026-07-01T08:05:00.000Z'),
    } as never);

    expect(dispatcher.publishFireAndForget).toHaveBeenCalledWith({
      type: 'datev_export.completed',
      scopeKey: 'tenant-a',
      clientId: undefined,
      data: expect.objectContaining({
        id: 'exp-1',
        periodYear: 2026,
        periodMonth: 6,
        bookingCount: 12,
        fileName: 'datev-export-2026-06.zip',
      }),
    });
  });

  it('publishes identity user lifecycle events with tenant scope', () => {
    const dispatcher = {
      publishFireAndForget: jest.fn(),
    } as unknown as NotificationDispatcherService;
    const publisher = new BillingNotificationPublisher(dispatcher);
    const payload = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'user',
    };

    publisher.publishUserCreated(payload);
    publisher.publishUserUpdated(payload);
    publisher.publishUserDeleted(payload);

    expect(dispatcher.publishFireAndForget).toHaveBeenNthCalledWith(1, {
      type: 'user.created',
      scopeKey: 'tenant-a',
      clientId: undefined,
      data: payload,
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenNthCalledWith(2, {
      type: 'user.updated',
      scopeKey: 'tenant-a',
      clientId: undefined,
      data: payload,
    });
    expect(dispatcher.publishFireAndForget).toHaveBeenNthCalledWith(3, {
      type: 'user.deleted',
      scopeKey: 'tenant-a',
      clientId: undefined,
      data: payload,
    });
  });
});
