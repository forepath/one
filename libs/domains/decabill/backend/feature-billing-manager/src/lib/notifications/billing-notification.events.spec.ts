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
        'customer_trust.level_changed',
        'payment.auto.initiated',
        'payment.auto.retry_scheduled',
        'payment.auto.exhausted',
        'subscription.cancel_scheduled',
        'subscription.resumed',
        'subscription.period_charged',
        'subscription.ssh_access_granted',
        'subscription.provisioned',
        'subscription.provision_failed',
        'service_plan.price_recalculated',
        'subscription.price_changed',
        'addon.activated',
        'meter.created',
        'meter.updated',
        'meter.deleted',
        'service_plan.meter_attached',
        'service_plan.meter_updated',
        'service_plan.meter_detached',
        'addon.meter_attached',
        'addon.meter_updated',
        'addon.meter_detached',
        'service_type.meter_attached',
        'service_type.meter_updated',
        'service_type.meter_detached',
        'usage.recorded',
        'usage.updated',
        'usage.deleted',
        'application.update_available',
        'application.update_check_failed',
        'application.instance_outdated',
        'application.dependency_health_changed',
      ]),
    );
  });
});
