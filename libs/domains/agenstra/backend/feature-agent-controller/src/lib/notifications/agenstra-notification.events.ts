import { IDENTITY_NOTIFICATION_EVENTS } from '@forepath/identity/backend';

export const AGENSTRA_NOTIFICATION_EVENTS = [
  ...IDENTITY_NOTIFICATION_EVENTS,
  'client.created',
  'client.updated',
  'client.deleted',
  'ticket.created',
  'ticket.updated',
  'ticket.deleted',
  'ticket.comment.created',
  'chat_message.created',
  'filter_rule.created',
  'filter_rule.updated',
  'filter_rule.deleted',
  'filter_rule.triggered',
  'environment.created',
  'environment.updated',
  'environment.deleted',
  'client_user.created',
  'client_user.deleted',
] as const;

export type AgenstraNotificationEventType = (typeof AGENSTRA_NOTIFICATION_EVENTS)[number];
