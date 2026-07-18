import { BILLING_NOTIFICATION_EVENTS } from './billing-notification.events';

describe('BILLING_NOTIFICATION_EVENTS', () => {
  it('contains unique event type strings', () => {
    expect(new Set(BILLING_NOTIFICATION_EVENTS).size).toBe(BILLING_NOTIFICATION_EVENTS.length);
  });

  it('includes identity, project, milestone, time entry, ticket, and auto-billing events', () => {
    expect(BILLING_NOTIFICATION_EVENTS).toEqual(
      expect.arrayContaining([
        'user.created',
        'user.updated',
        'user.deleted',
        'project.created',
        'project.updated',
        'project.deleted',
        'milestone.created',
        'milestone.updated',
        'milestone.deleted',
        'time_entry.created',
        'time_entry.updated',
        'time_entry.deleted',
        'ticket.created',
        'ticket.updated',
        'ticket.deleted',
        'ticket.comment.created',
        'datev_export.started',
        'datev_export.completed',
        'datev_export.failed',
        'auto_billing.enabled',
        'auto_billing.disabled',
        'payment_method.attached',
        'payment.auto.initiated',
        'payment.auto.retry_scheduled',
        'payment.auto.exhausted',
      ]),
    );
  });
});
