import { AGENSTRA_NOTIFICATION_EVENTS } from './agenstra-notification.events';

describe('AGENSTRA_NOTIFICATION_EVENTS', () => {
  it('no longer exposes the removed filter rule CRUD events', () => {
    expect(AGENSTRA_NOTIFICATION_EVENTS).not.toEqual(
      expect.arrayContaining([
        'filter_rule.created',
        'filter_rule.updated',
        'filter_rule.deleted',
        'filter_rule.triggered',
      ]),
    );
  });

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
        'agent.acp.session_failed',
        'agent.acp.permission_denied',
        'agent.chat.failed',
        'message_filter.triggered',
        'agent_config.updated',
        'egress.blocked',
        'egress.observed',
        'egress.guard_failed',
        'egress.policy_applied',
        'egress.policy_failed',
        'isolation.sandbox_available',
        'isolation.sandbox_unavailable',
        'isolation.baseline_failed',
        'agent.isolation_override',
        'agent.sandbox_creation_failed',
        'environment.created',
        'environment.updated',
        'environment.deleted',
        'chat_session.created',
        'chat_session.updated',
        'chat_session.deleted',
        'ticket.comment.created',
        'attachment.created',
        'attachment.deleted',
        'application.update_available',
        'application.update_check_failed',
        'application.instance_outdated',
        'application.dependency_health_changed',
      ]),
    );
  });
});
