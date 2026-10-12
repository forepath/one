import { ClientEntity, IIdentityNotificationPublisher } from '@forepath/identity/backend';
import { INSTANCE_SCOPE_KEY, NotificationDispatcherService } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';

import type {
  ChatSessionResponseDto,
  EnvironmentVariableResponseDto,
} from '@forepath/agenstra/backend/feature-agent-manager';

import type { ClientResponseDto } from '../dto/client-response.dto';
import type { AttachmentResponseDto } from '../dto/attachment.dto';
import type { TicketCommentResponseDto } from '../dto/tickets/ticket-comment-response.dto';
import type { TicketResponseDto } from '../dto/tickets/ticket-response.dto';

import { AGENSTRA_NOTIFICATION_EVENTS, type AgenstraNotificationEventType } from './agenstra-notification.events';

export { AGENSTRA_NOTIFICATION_EVENTS, type AgenstraNotificationEventType };

export type ChatMessageDirection = 'incoming' | 'outgoing';
export type ChatMessageSource = 'user' | 'agent';
export type MessageFilterTriggerStatus = 'dropped' | 'filtered';

export type ChatMessageNotificationPayload = {
  agentId: string;
  direction: ChatMessageDirection;
  source: ChatMessageSource;
  message: string;
  userId?: string | null;
  interactionKind?: string | null;
  chatId?: string | null;
};

export type MessageFilterTriggeredNotificationPayload = {
  agentId: string;
  direction: ChatMessageDirection;
  status: MessageFilterTriggerStatus;
  filterType: string;
  filterDisplayName: string;
  reason?: string | null;
  wordCount: number;
  charCount: number;
  userId?: string | null;
  messagePreview?: string | null;
};

/** Layer of the agent configuration that was saved. */
export type AgentConfigLayer = 'global' | 'workspace' | 'environment';

export type AgentConfigUpdatedNotificationPayload = {
  layer: AgentConfigLayer;
  clientId?: string | null;
  agentId?: string | null;
  /** Root keys whose values (config, overrides or locks) changed. Values are never included. */
  changedRoots: string[];
  /** Subset of `changedRoots` that are security policy roots (`permissions`, `egress`, `message_filters`, …). */
  securityRootsChanged: string[];
  locksChanged: boolean;
  secretKeysChanged: string[];
  updatedByUserId?: string | null;
};

export type EgressDecisionNotificationPayload = {
  agentId: string;
  kind: string;
  decision: string;
  host?: string | null;
  rule?: string | null;
  matchedEntry?: string | null;
  matchedSource?: string | null;
  method?: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Number of further distinct decisions omitted from this ingestion batch (notification cap). */
  omittedDecisions?: number;
};

export type EgressGuardFailedNotificationPayload = {
  agentId: string;
  message: string;
  occurredAt: string;
};

export type EgressPolicyNotificationPayload = {
  agentId: string;
  mode: string;
  revision?: string | null;
  error?: string | null;
};

export type EnvironmentNotificationPayload = {
  id: string;
  agentId: string;
  variable?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ChatSessionNotificationPayload = {
  id: string;
  agentId: string;
  title?: string | null;
  kind?: string | null;
  lastMessageAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type TicketCommentNotificationPayload = {
  id: string;
  ticketId: string;
  authorUserId?: string | null;
  body: string;
  createdAt: string;
};

@Injectable()
export class AgenstraNotificationPublisher implements IIdentityNotificationPublisher {
  constructor(private readonly dispatcher: NotificationDispatcherService) {}

  publish(type: AgenstraNotificationEventType, data: Record<string, unknown>, clientId?: string): void {
    this.dispatcher.publishFireAndForget({
      type,
      scopeKey: INSTANCE_SCOPE_KEY,
      clientId,
      data,
    });
  }

  publishClient(
    type: 'client.created' | 'client.updated' | 'client.deleted',
    client: ClientEntity | ClientResponseDto,
  ): void {
    this.publish(type, this.toClientPayload(client), client.id);
  }

  publishTicket(type: 'ticket.created' | 'ticket.updated' | 'ticket.deleted', ticket: TicketResponseDto): void {
    this.publish(type, this.toTicketPayload(ticket), ticket.clientId);
  }

  publishTicketComment(clientId: string, comment: TicketCommentResponseDto | TicketCommentNotificationPayload): void {
    this.publish('ticket.comment.created', this.toTicketCommentPayload(comment), clientId);
  }

  publishAttachment(type: 'attachment.created' | 'attachment.deleted', attachment: AttachmentResponseDto): void {
    this.publish(type, this.toAttachmentPayload(attachment), attachment.clientId);
  }

  publishChatMessage(clientId: string, payload: ChatMessageNotificationPayload): void {
    this.publish('chat_message.created', payload, clientId);
  }

  publishAgentAcpSessionFailed(
    clientId: string,
    payload: { agentId: string; message?: string | null; code?: string | null },
  ): void {
    this.publish('agent.acp.session_failed', payload, clientId);
  }

  publishAgentAcpPermissionDenied(clientId: string, payload: { agentId: string; message?: string | null }): void {
    this.publish('agent.acp.permission_denied', payload, clientId);
  }

  publishAgentChatFailed(
    clientId: string,
    payload: { agentId: string; message?: string | null; code?: string | null },
  ): void {
    this.publish('agent.chat.failed', payload, clientId);
  }

  publishMessageFilterTriggered(clientId: string, payload: MessageFilterTriggeredNotificationPayload): void {
    this.publish('message_filter.triggered', payload, clientId);
  }

  /** Agent configuration layer saved (global layer: no clientId → instance-wide delivery). */
  publishAgentConfigUpdated(payload: AgentConfigUpdatedNotificationPayload): void {
    this.publish('agent_config.updated', payload, payload.clientId ?? undefined);
  }

  publishEgressDecision(
    type: 'egress.blocked' | 'egress.observed',
    clientId: string,
    payload: EgressDecisionNotificationPayload,
  ): void {
    this.publish(type, payload, clientId);
  }

  publishEgressGuardFailed(clientId: string, payload: EgressGuardFailedNotificationPayload): void {
    this.publish('egress.guard_failed', payload, clientId);
  }

  publishEgressPolicy(
    type: 'egress.policy_applied' | 'egress.policy_failed',
    clientId: string,
    payload: EgressPolicyNotificationPayload,
  ): void {
    this.publish(type, payload, clientId);
  }

  publishEnvironment(
    type: 'environment.created' | 'environment.updated' | 'environment.deleted',
    clientId: string,
    environment: EnvironmentVariableResponseDto | EnvironmentNotificationPayload,
  ): void {
    this.publish(type, this.toEnvironmentPayload(environment), clientId);
  }

  publishChatSession(
    type: 'chat_session.created' | 'chat_session.updated' | 'chat_session.deleted',
    clientId: string,
    chatSession: ChatSessionResponseDto | ChatSessionNotificationPayload,
  ): void {
    this.publish(type, this.toChatSessionPayload(chatSession), clientId);
  }

  publishUserCreated(data: Record<string, unknown>): void {
    this.publish('user.created', data);
  }

  publishUserUpdated(data: Record<string, unknown>): void {
    this.publish('user.updated', data);
  }

  publishUserDeleted(data: Record<string, unknown>): void {
    this.publish('user.deleted', data);
  }

  publishClientUserCreated(data: Record<string, unknown>, clientId: string): void {
    this.publish('client_user.created', data, clientId);
  }

  publishClientUserDeleted(data: Record<string, unknown>, clientId: string): void {
    this.publish('client_user.deleted', data, clientId);
  }

  private toClientPayload(client: ClientEntity | ClientResponseDto): Record<string, unknown> {
    return {
      id: client.id,
      name: client.name,
      description: client.description ?? null,
      endpoint: client.endpoint,
      authenticationType: client.authenticationType,
      createdAt: client.createdAt instanceof Date ? client.createdAt.toISOString() : client.createdAt,
      updatedAt: client.updatedAt instanceof Date ? client.updatedAt.toISOString() : client.updatedAt,
    };
  }

  private toTicketPayload(ticket: TicketResponseDto): Record<string, unknown> {
    return {
      id: ticket.id,
      clientId: ticket.clientId,
      parentId: ticket.parentId ?? null,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      createdByUserId: ticket.createdByUserId ?? null,
      preferredChatAgentId: ticket.preferredChatAgentId ?? null,
      automationEligible: ticket.automationEligible,
      createdAt: ticket.createdAt instanceof Date ? ticket.createdAt.toISOString() : ticket.createdAt,
      updatedAt: ticket.updatedAt instanceof Date ? ticket.updatedAt.toISOString() : ticket.updatedAt,
    };
  }

  private toTicketCommentPayload(
    comment: TicketCommentResponseDto | TicketCommentNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: comment.id,
      ticketId: comment.ticketId,
      authorUserId: 'authorUserId' in comment ? (comment.authorUserId ?? null) : null,
      body: comment.body,
      createdAt: this.toIsoString(comment.createdAt),
    };
  }

  private toAttachmentPayload(attachment: AttachmentResponseDto): Record<string, unknown> {
    return {
      id: attachment.id,
      clientId: attachment.clientId,
      ownerType: attachment.ownerType,
      ownerId: attachment.ownerId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      contentSha256: attachment.contentSha256,
      createdByUserId: attachment.createdByUserId ?? null,
      createdAt: this.toIsoString(attachment.createdAt),
    };
  }

  private toEnvironmentPayload(
    environment: EnvironmentVariableResponseDto | EnvironmentNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: environment.id,
      agentId: environment.agentId,
      variable: 'variable' in environment ? (environment.variable ?? null) : null,
      createdAt: this.toIsoString(environment.createdAt),
      updatedAt: this.toIsoString(environment.updatedAt),
    };
  }

  private toChatSessionPayload(
    chatSession: ChatSessionResponseDto | ChatSessionNotificationPayload,
  ): Record<string, unknown> {
    return {
      id: chatSession.id,
      agentId: chatSession.agentId,
      title: 'title' in chatSession ? (chatSession.title ?? null) : null,
      kind: 'kind' in chatSession ? (chatSession.kind ?? null) : null,
      lastMessageAt: this.toIsoString('lastMessageAt' in chatSession ? chatSession.lastMessageAt : null),
      createdAt: this.toIsoString(chatSession.createdAt),
      updatedAt: this.toIsoString(chatSession.updatedAt),
    };
  }

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (value == null) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
