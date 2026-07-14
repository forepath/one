import { ClientEntity, IIdentityNotificationPublisher } from '@forepath/identity/backend';
import { INSTANCE_SCOPE_KEY, NotificationDispatcherService } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';

import type { EnvironmentVariableResponseDto } from '@forepath/agenstra/backend/feature-agent-manager';

import type { FilterRuleResponseDto } from '../dto/filter-rules/filter-rule-response.dto';
import type { ClientResponseDto } from '../dto/client-response.dto';
import type { TicketCommentResponseDto } from '../dto/tickets/ticket-comment-response.dto';
import type { TicketResponseDto } from '../dto/tickets/ticket-response.dto';

import { AGENSTRA_NOTIFICATION_EVENTS, type AgenstraNotificationEventType } from './agenstra-notification.events';

export { AGENSTRA_NOTIFICATION_EVENTS, type AgenstraNotificationEventType };

export type ChatMessageDirection = 'incoming' | 'outgoing';
export type ChatMessageSource = 'user' | 'agent';
export type FilterRuleTriggerStatus = 'dropped' | 'filtered';

export type ChatMessageNotificationPayload = {
  agentId: string;
  direction: ChatMessageDirection;
  source: ChatMessageSource;
  message: string;
  userId?: string | null;
  interactionKind?: string | null;
};

export type FilterRuleTriggeredNotificationPayload = {
  agentId: string;
  direction: ChatMessageDirection;
  status: FilterRuleTriggerStatus;
  filterType: string;
  filterDisplayName: string;
  reason?: string | null;
  wordCount: number;
  charCount: number;
  userId?: string | null;
  messagePreview?: string | null;
};

export type EnvironmentNotificationPayload = {
  id: string;
  agentId: string;
  variable?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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

  publishFilterRule(
    type: 'filter_rule.created' | 'filter_rule.updated' | 'filter_rule.deleted',
    rule: FilterRuleResponseDto,
  ): void {
    const data = this.toFilterRulePayload(rule);

    if (rule.isGlobal || rule.workspaceIds.length === 0) {
      this.publish(type, data);

      return;
    }

    for (const clientId of rule.workspaceIds) {
      this.publish(type, data, clientId);
    }
  }

  publishChatMessage(clientId: string, payload: ChatMessageNotificationPayload): void {
    this.publish('chat_message.created', payload, clientId);
  }

  publishFilterRuleTriggered(clientId: string, payload: FilterRuleTriggeredNotificationPayload): void {
    this.publish('filter_rule.triggered', payload, clientId);
  }

  publishEnvironment(
    type: 'environment.created' | 'environment.updated' | 'environment.deleted',
    clientId: string,
    environment: EnvironmentVariableResponseDto | EnvironmentNotificationPayload,
  ): void {
    this.publish(type, this.toEnvironmentPayload(environment), clientId);
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

  private toFilterRulePayload(rule: FilterRuleResponseDto): Record<string, unknown> {
    return {
      id: rule.id,
      pattern: rule.pattern,
      regexFlags: rule.regexFlags,
      direction: rule.direction,
      filterType: rule.filterType,
      replaceContent: rule.replaceContent ?? null,
      priority: rule.priority,
      enabled: rule.enabled,
      isGlobal: rule.isGlobal,
      workspaceIds: rule.workspaceIds,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
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

  private toIsoString(value: Date | string | null | undefined): string | null {
    if (value == null) {
      return null;
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
