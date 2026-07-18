import { AGENSTRA_NOTIFICATION_EVENTS } from './agenstra-notification.events';

describe('AGENSTRA_NOTIFICATION_EVENTS', () => {
  it('contains unique event type strings', () => {
    expect(new Set(AGENSTRA_NOTIFICATION_EVENTS).size).toBe(AGENSTRA_NOTIFICATION_EVENTS.length);
  });

  it('includes identity, chat, filter trigger, and environment lifecycle events', () => {
    expect(AGENSTRA_NOTIFICATION_EVENTS).toEqual(
      expect.arrayContaining([
        'user.created',
        'user.updated',
        'user.deleted',
        'client_user.created',
        'client_user.deleted',
        'chat_message.created',
        'filter_rule.triggered',
        'environment.created',
        'environment.updated',
        'environment.deleted',
        'ticket.comment.created',
      ]),
    );
  });
});
