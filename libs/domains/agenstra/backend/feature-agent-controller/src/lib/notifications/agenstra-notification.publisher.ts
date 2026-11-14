import type {
  AgentResponseDto,
  ChatSessionResponseDto,
  EnvironmentVariableResponseDto,
} from '@forepath/agenstra/backend/feature-agent-manager';
import type { DeploymentRunSummary, DeploymentWorkflowSummary } from '@forepath/agenstra/shared/util-opencode-config';
import { ClientEntity, IIdentityNotificationPublisher } from '@forepath/identity/backend';
import { INSTANCE_SCOPE_KEY, NotificationDispatcherService } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';


import type { AttachmentResponseDto } from '../dto/attachment.dto';
import type { ClientResponseDto } from '../dto/client-response.dto';
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

export type IsolationHostTransitionType =
  | 'isolation.sandbox_available'
  | 'isolation.sandbox_unavailable'
  | 'isolation.sandbox_kvm_available'
  | 'isolation.sandbox_kvm_unavailable'
  | 'isolation.microvm_available'
  | 'isolation.microvm_unavailable'
  | 'isolation.baseline_failed';

/** Isolation capability transition of a workspace host (agent manager). */
export type IsolationHostNotificationPayload = {
  clientId: string;
  clientName?: string | null;
  level: 'standard' | 'sandboxed' | 'sandboxed-kvm' | 'microvm';
  runtime: string;
  previousState?: string | null;
  state: string;
  reasonCode?: string | null;
  recommendedLevel?: string | null;
  revision: string;
  probedAt?: string | null;
};

/** An environment was created with weaker isolation than recommended (explicit user choice). */
export type AgentIsolationOverrideNotificationPayload = {
  agentId: string;
  agentName?: string | null;
  automaticSelection: string;
  effectiveSelection: string;
  selectedBy?: string | null;
  capabilityRevision?: string | null;
};

/** Creating a gVisor (sandboxed / sandboxed-kvm) or microVM environment failed (never retried on a weaker runtime). */
export type AgentSandboxCreationFailedNotificationPayload = {
  agentName: string;
  isolationLevel: 'sandboxed' | 'sandboxed-kvm' | 'microvm';
  runtime: string;
  error: string;
  occurredAt: string;
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

/** Agent (environment) lifecycle payload. Credentials, git remotes and chat contents are never included. */
export type AgentNotificationPayload = {
  id: string;
  clientId: string;
  name?: string | null;
  description?: string | null;
  agentType?: string | null;
  isolationLevel?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type KnowledgeNodeNotificationPayload = {
  id: string;
  clientId: string;
  nodeType: string;
  title: string;
  parentId?: string | null;
  sortOrder?: number | null;
  longSha?: string | null;
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

  /**
   * Agent (environment) lifecycle. Explicit allowlist: the create response also carries the generated agent
   * password, which must never reach a webhook payload.
   */
  publishAgent(
    type: 'agent.created' | 'agent.updated' | 'agent.deleted',
    clientId: string,
    agent: AgentResponseDto | AgentNotificationPayload,
  ): void {
    this.publish(type, this.toAgentPayload(clientId, agent), clientId);
  }

  /** Knowledge tree node (folder / page) lifecycle. Page `content` is never included. */
  publishKnowledgeNode(
    type: 'knowledge_node.created' | 'knowledge_node.updated' | 'knowledge_node.deleted',
    node: KnowledgeNodeNotificationPayload,
  ): void {
    this.publish(type, this.toKnowledgeNodePayload(node), node.clientId);
  }

  publishTicket(type: 'ticket.created' | 'ticket.updated' | 'ticket.deleted', ticket: TicketResponseDto): void {
    this.publish(type, this.toTicketPayload(ticket), ticket.clientId);
  }

  /** Workflow metadata only; default inputs are never included (they may carry deployment parameters). */
  publishDeploymentWorkflow(
    type: 'deployment_workflow.created' | 'deployment_workflow.updated' | 'deployment_workflow.deleted',
    workflow: DeploymentWorkflowSummary,
  ): void {
    this.publish(type, this.toDeploymentWorkflowPayload(workflow), workflow.clientId);
  }

  /** `created`: triggered through Agenstra (console / environment); `completed`: any recorded run finished. */
  publishDeploymentRun(type: 'deployment_run.created' | 'deployment_run.completed', run: DeploymentRunSummary): void {
    this.publish(type, this.toDeploymentRunPayload(run), run.clientId);
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

  publishAgentSessionFailed(
    clientId: string,
    payload: { agentId: string; message?: string | null; code?: string | null },
  ): void {
    this.publish('agent.session_failed', payload, clientId);
  }

  publishAgentPermissionDenied(clientId: string, payload: { agentId: string; message?: string | null }): void {
    this.publish('agent.permission_denied', payload, clientId);
  }

  publishAgentChatFailed(
    clientId: string,
    payload: { agentId: string; message?: string | null; code?: string | null },
  ): void {
    this.publish('agent.chat_failed', payload, clientId);
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

  publishIsolationHostTransition(
    type: IsolationHostTransitionType,
    clientId: string,
    payload: IsolationHostNotificationPayload,
  ): void {
    this.publish(type, payload, clientId);
  }

  publishAgentIsolationOverride(clientId: string, payload: AgentIsolationOverrideNotificationPayload): void {
    this.publish('agent.isolation_overridden', payload, clientId);
  }

  publishAgentSandboxCreationFailed(clientId: string, payload: AgentSandboxCreationFailedNotificationPayload): void {
    this.publish('agent.sandbox_creation_failed', payload, clientId);
  }

  publishEnvironmentVariable(
    type: 'environment_variable.created' | 'environment_variable.updated' | 'environment_variable.deleted',
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

  private toAgentPayload(
    clientId: string,
    agent: AgentResponseDto | AgentNotificationPayload,
  ): Record<string, unknown> {
    const isolationLevel =
      'isolationLevel' in agent
        ? (agent.isolationLevel ?? null)
        : 'isolation' in agent
          ? (agent.isolation?.level ?? null)
          : null;

    return {
      id: agent.id,
      clientId,
      name: agent.name ?? null,
      description: agent.description ?? null,
      agentType: agent.agentType ?? null,
      isolationLevel,
      createdAt: this.toIsoString(agent.createdAt),
      updatedAt: this.toIsoString(agent.updatedAt),
    };
  }

  private toKnowledgeNodePayload(node: KnowledgeNodeNotificationPayload): Record<string, unknown> {
    return {
      id: node.id,
      clientId: node.clientId,
      nodeType: node.nodeType,
      title: node.title,
      parentId: node.parentId ?? null,
      sortOrder: node.sortOrder ?? null,
      longSha: node.longSha ?? null,
      createdAt: this.toIsoString(node.createdAt),
      updatedAt: this.toIsoString(node.updatedAt),
    };
  }

  private toDeploymentWorkflowPayload(workflow: DeploymentWorkflowSummary): Record<string, unknown> {
    return {
      id: workflow.id,
      clientId: workflow.clientId,
      connectionId: workflow.connectionId,
      provider: workflow.provider,
      name: workflow.name,
      repository: workflow.repository,
      workflow: workflow.workflow,
      defaultRef: workflow.defaultRef,
      scope: workflow.scope,
      agentIds: workflow.agentIds,
      agentTriggerEnabled: workflow.agentTriggerEnabled,
      enabled: workflow.enabled,
      approvalStatus: workflow.approvalStatus,
      approvedAt: workflow.approvedAt,
      createdBy: workflow.createdBy,
      updatedBy: workflow.updatedBy,
      createdByAgentId: workflow.createdByAgentId,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    };
  }

  private toDeploymentRunPayload(run: DeploymentRunSummary): Record<string, unknown> {
    return {
      id: run.id,
      clientId: run.clientId,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      agentId: run.agentId,
      providerRunId: run.providerRunId,
      status: run.status,
      conclusion: run.conclusion,
      ref: run.ref,
      sha: run.sha,
      url: run.url,
      triggeredBy: run.triggeredBy,
      triggeredByUserId: run.triggeredByUserId,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.createdAt,
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
