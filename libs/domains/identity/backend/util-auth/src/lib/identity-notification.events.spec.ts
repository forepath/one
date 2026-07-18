import { IDENTITY_NOTIFICATION_EVENTS } from './identity-notification.events';

describe('IDENTITY_NOTIFICATION_EVENTS', () => {
  it('contains unique event type strings', () => {
    expect(new Set(IDENTITY_NOTIFICATION_EVENTS).size).toBe(IDENTITY_NOTIFICATION_EVENTS.length);
  });

  it('includes user lifecycle events', () => {
    expect(IDENTITY_NOTIFICATION_EVENTS).toEqual(['user.created', 'user.updated', 'user.deleted']);
  });
});
