import { BILLING_NOTIFICATION_EVENTS } from './billing-notification.events';

describe('BILLING_NOTIFICATION_EVENTS', () => {
  it('contains unique event type strings', () => {
    expect(new Set(BILLING_NOTIFICATION_EVENTS).size).toBe(BILLING_NOTIFICATION_EVENTS.length);
  });

  it('includes project, milestone, time entry, and ticket lifecycle events', () => {
    expect(BILLING_NOTIFICATION_EVENTS).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });
});
