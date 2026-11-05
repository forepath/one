import { findWebhookEventCatalogViolations } from '@forepath/shared/backend';

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

  it('follows the shared webhook event naming convention', () => {
    expect(findWebhookEventCatalogViolations(AGENSTRA_NOTIFICATION_EVENTS)).toEqual({ invalid: [], duplicates: [] });
  });

  it('no longer exposes legacy names (renamed by UnifyAgenstraWebhookEventNames1793800000000)', () => {
    for (const legacy of [
      'agent.chat.failed',
      'agent.isolation_override',
      'environment.created',
      'environment.updated',
      'environment.deleted',
    ]) {
      expect(AGENSTRA_NOTIFICATION_EVENTS).not.toContain(legacy);
    }
  });

  it('includes agent and knowledge node lifecycle events', () => {
    expect(AGENSTRA_NOTIFICATION_EVENTS).toEqual(
      expect.arrayContaining([
        'agent.created',
        'agent.updated',
        'agent.deleted',
        'knowledge_node.created',
        'knowledge_node.updated',
        'knowledge_node.deleted',
        'search.document.sync_failed',
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
        'agent.session_failed',
        'agent.permission_denied',
        'agent.chat_failed',
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
        'agent.isolation_overridden',
        'agent.sandbox_creation_failed',
        'environment_variable.created',
        'environment_variable.updated',
        'environment_variable.deleted',
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
