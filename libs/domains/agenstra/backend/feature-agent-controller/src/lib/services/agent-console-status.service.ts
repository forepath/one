import { AgentResponseDto, GitStatusDto } from '@forepath/agenstra/backend/feature-agent-manager';
import {
  checkClientAccess,
  ClientUsersRepository,
  ensureClientAccess,
  type SocketUserInfo,
  buildRequestFromSocketUser,
  UserRole,
} from '@forepath/identity/backend';
import { ForbiddenException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import {
  ChatSessionStatusPayload,
  ClientEnvironmentProgressPayload,
  ClientStatusPayload,
  EnvironmentStatusPayload,
  StatusPatchPayload,
  StatusSnapshotPayload,
} from '../dto/agent-console-status.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { TicketAutomationRunsStatusRepository } from '../repositories/ticket-automation-runs-status.repository';
import { UserChatSessionReadStateRepository } from '../repositories/user-chat-session-read-state.repository';
import { UserEnvironmentReadStateRepository } from '../repositories/user-environment-read-state.repository';

import { AgentConsoleStatusRealtimeService } from './agent-console-status-realtime.service';
import { ClientAgentMessagesProxyService } from './client-agent-messages-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { ClientAgentVcsProxyService } from './client-agent-vcs-proxy.service';
import { ClientsService } from './clients.service';

const DEFAULT_VCS_CONCURRENCY = 3;

type ActiveEnvironment = { clientId: string; agentId: string; chatSessionId: string | null };

function resolveUserId(userInfo: SocketUserInfo): string | null {
  return userInfo.user?.id ?? userInfo.userId ?? null;
}

function mapGitStatus(status: GitStatusDto): { gitDirty: boolean; gitConflict: boolean } {
  const hasConflicts = status.files.some((f) => f.status.includes('U'));
  const gitDirty = !status.isClean || status.hasUnpushedCommits;

  return { gitDirty, gitConflict: hasConflicts };
}

function rollupClients(environments: EnvironmentStatusPayload[]): ClientStatusPayload[] {
  const byClient = new Map<string, ClientStatusPayload>();

  for (const env of environments) {
    const existing = byClient.get(env.clientId) ?? {
      clientId: env.clientId,
      hasUnreadMessages: false,
      gitDirty: false,
    };

    existing.hasUnreadMessages = existing.hasUnreadMessages || env.hasUnreadMessages;
    existing.gitDirty = existing.gitDirty || env.gitDirty;
    byClient.set(env.clientId, existing);
  }

  return [...byClient.values()];
}

function spacesHasAttention(clients: ClientStatusPayload[]): boolean {
  return clients.some((c) => c.hasUnreadMessages || c.gitDirty);
}

function chatsEqual(a: ChatSessionStatusPayload[] | undefined, b: ChatSessionStatusPayload[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];

  if (left.length !== right.length) {
    return false;
  }

  const rightById = new Map(right.map((c) => [c.chatSessionId, c.hasUnreadMessages]));

  return left.every((c) => rightById.get(c.chatSessionId) === c.hasUnreadMessages);
}

function diffEnvironmentProgress(
  previous: ClientEnvironmentProgressPayload[] | undefined,
  next: ClientEnvironmentProgressPayload[] | undefined,
): ClientEnvironmentProgressPayload[] {
  const prevByClient = new Map((previous ?? []).map((p) => [p.clientId, JSON.stringify(p.operations)]));
  const nextByClient = new Map((next ?? []).map((p) => [p.clientId, p]));
  const changed: ClientEnvironmentProgressPayload[] = [];

  for (const [clientId, entry] of nextByClient.entries()) {
    if (prevByClient.get(clientId) !== JSON.stringify(entry.operations)) {
      changed.push(entry);
    }
  }

  for (const clientId of prevByClient.keys()) {
    if (!nextByClient.has(clientId)) {
      changed.push({ clientId, operations: [] });
    }
  }

  return changed;
}

@Injectable()
export class AgentConsoleStatusService {
  private readonly logger = new Logger(AgentConsoleStatusService.name);
  private readonly activeEnvironmentBySocketId = new Map<string, ActiveEnvironment | null>();
  private readonly lastSnapshotBySocketId = new Map<string, StatusSnapshotPayload>();

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly readStateRepository: UserEnvironmentReadStateRepository,
    private readonly chatReadStateRepository: UserChatSessionReadStateRepository,
    private readonly automationRunsStatusRepository: TicketAutomationRunsStatusRepository,
    private readonly messagesProxy: ClientAgentMessagesProxyService,
    @Inject(forwardRef(() => ClientAgentVcsProxyService))
    private readonly vcsProxy: ClientAgentVcsProxyService,
    private readonly agentProxy: ClientAgentProxyService,
    private readonly realtime: AgentConsoleStatusRealtimeService,
  ) {}

  setActiveEnvironment(
    socketId: string,
    clientId: string | null,
    agentId: string | null,
    chatSessionId?: string | null,
  ): void {
    if (!clientId || !agentId) {
      this.activeEnvironmentBySocketId.set(socketId, null);

      return;
    }

    this.activeEnvironmentBySocketId.set(socketId, {
      clientId,
      agentId,
      chatSessionId: chatSessionId ?? null,
    });
  }

  clearSocket(socketId: string): void {
    this.activeEnvironmentBySocketId.delete(socketId);
    this.lastSnapshotBySocketId.delete(socketId);
  }

  async assertEnvironmentAccess(userInfo: SocketUserInfo, clientId: string, agentId: string): Promise<void> {
    await ensureClientAccess(
      this.clientsRepository,
      this.clientUsersRepository,
      clientId,
      buildRequestFromSocketUser(userInfo),
    );

    const agents = await this.agentProxy.getClientAgents(clientId, 1000, 0);

    if (!agents.some((a) => a.id === agentId)) {
      throw new ForbiddenException('You do not have access to this environment');
    }
  }

  async markEnvironmentRead(
    userInfo: SocketUserInfo,
    clientId: string,
    agentId: string,
    chatSessionId?: string,
  ): Promise<void> {
    const userId = resolveUserId(userInfo);

    if (!userId) {
      return;
    }

    await this.assertEnvironmentAccess(userInfo, clientId, agentId);

    const resolvedChatId = chatSessionId ?? (await this.resolvePrimaryChatId(clientId, agentId));
    const latest = await this.messagesProxy.getLatestAgentMessage(clientId, agentId, resolvedChatId ?? undefined);
    const latestAt = latest?.createdAt ? new Date(latest.createdAt) : null;
    const readAt = this.maxDate(new Date(), latestAt) ?? new Date();

    await this.readStateRepository.upsertReadState({
      userId,
      clientId,
      agentId,
      lastReadAt: readAt,
      lastReadAgentMessageId: latest?.id ?? null,
    });

    if (resolvedChatId) {
      await this.chatReadStateRepository.upsertReadState({
        userId,
        clientId,
        agentId,
        chatSessionId: resolvedChatId,
        lastReadAt: readAt,
        lastReadAgentMessageId: latest?.id ?? null,
      });
    }

    await this.pushPatchForUser(userId, clientId, agentId);
  }

  async markChatSessionRead(
    userInfo: SocketUserInfo,
    clientId: string,
    agentId: string,
    chatSessionId: string,
  ): Promise<void> {
    const userId = resolveUserId(userInfo);

    if (!userId) {
      return;
    }

    await this.assertEnvironmentAccess(userInfo, clientId, agentId);

    const latest = await this.messagesProxy.getLatestAgentMessage(clientId, agentId, chatSessionId);
    const latestAt = latest?.createdAt ? new Date(latest.createdAt) : null;
    const readAt = this.maxDate(new Date(), latestAt) ?? new Date();

    await this.chatReadStateRepository.upsertReadState({
      userId,
      clientId,
      agentId,
      chatSessionId,
      lastReadAt: readAt,
      lastReadAgentMessageId: latest?.id ?? null,
    });

    await this.readStateRepository.upsertReadState({
      userId,
      clientId,
      agentId,
      lastReadAt: readAt,
      lastReadAgentMessageId: latest?.id ?? null,
    });

    await this.pushPatchForUser(userId, clientId, agentId);
  }

  async buildSnapshotForUser(userInfo: SocketUserInfo): Promise<StatusSnapshotPayload> {
    const userId = resolveUserId(userInfo);

    if (!userId) {
      return {
        generatedAt: new Date().toISOString(),
        environments: [],
        clients: [],
        spacesHasAttention: false,
      };
    }

    const clientIds = await this.clientsService.getAccessibleClientIds(
      userInfo.userId ?? userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
      { amr: userInfo.amr },
    );
    const [environments, environmentProgress] = await Promise.all([
      this.buildEnvironmentsForUser(userId, clientIds),
      this.buildEnvironmentProgress(clientIds),
    ]);
    const clients = rollupClients(environments);

    return {
      generatedAt: new Date().toISOString(),
      environments,
      clients,
      spacesHasAttention: spacesHasAttention(clients),
      ...(environmentProgress.length ? { environmentProgress } : {}),
    };
  }

  /** Whether the last snapshot sent to this socket contains running environment provisioning operations. */
  hasActiveEnvironmentProgress(socketId: string): boolean {
    return (this.lastSnapshotBySocketId.get(socketId)?.environmentProgress ?? []).some(
      (entry) => entry.operations.length > 0,
    );
  }

  /**
   * Lightweight poll used while provisioning is active: refreshes only environment progress for all
   * accessible workspaces and emits a progress-only statusPatch when something changed.
   */
  async runProgressPollForSocket(socketId: string, userInfo: SocketUserInfo): Promise<void> {
    const userId = resolveUserId(userInfo);
    const previous = this.lastSnapshotBySocketId.get(socketId);

    if (!userId || !previous) {
      return;
    }

    const clientIds = await this.clientsService.getAccessibleClientIds(
      userInfo.userId ?? userId,
      userInfo.userRole,
      userInfo.isApiKeyAuth,
      { amr: userInfo.amr },
    );
    const environmentProgress = await this.buildEnvironmentProgress(clientIds);
    const changed = diffEnvironmentProgress(previous.environmentProgress, environmentProgress);
    const current = this.lastSnapshotBySocketId.get(socketId);

    if (current) {
      current.environmentProgress = environmentProgress.length ? environmentProgress : undefined;
    }

    if (changed.length) {
      this.realtime.emitToUser(userId, 'statusPatch', {
        generatedAt: new Date().toISOString(),
        environmentProgress: changed,
      } satisfies StatusPatchPayload);
    }
  }

  async emitSnapshotToSocket(socketId: string, userInfo: SocketUserInfo): Promise<StatusSnapshotPayload> {
    const snapshot = await this.buildSnapshotForUser(userInfo);

    this.lastSnapshotBySocketId.set(socketId, snapshot);
    this.realtime.emitToUser(resolveUserId(userInfo) ?? '', 'statusSnapshot', snapshot);

    return snapshot;
  }

  async runPollForSocket(socketId: string, userInfo: SocketUserInfo): Promise<void> {
    const userId = resolveUserId(userInfo);

    if (!userId) {
      return;
    }

    const previous = this.lastSnapshotBySocketId.get(socketId);
    const next = await this.buildSnapshotForUser(userInfo);

    this.lastSnapshotBySocketId.set(socketId, next);

    const patch = this.diffSnapshots(previous, next);

    if (patch) {
      this.realtime.emitToUser(userId, 'statusPatch', patch);
    }
  }

  async onAgentChatActivity(
    clientId: string,
    agentId: string,
    chatSessionId?: string | null,
    activityAt = new Date(),
  ): Promise<void> {
    const resolvedChatId = chatSessionId ?? (await this.resolvePrimaryChatId(clientId, agentId));

    await this.notifyChatActivity(clientId, agentId, resolvedChatId, activityAt);
  }

  async onAutomationChatActivity(clientId: string, agentId: string, activityAt = new Date()): Promise<void> {
    const primaryChatId = await this.resolvePrimaryChatId(clientId, agentId);

    await this.notifyChatActivity(clientId, agentId, primaryChatId, activityAt);
  }

  /**
   * Pushes a status patch after git state changes (VCS mutations).
   * Notifies every user with access to the workspace, same as chat activity hooks.
   */
  async notifyVcsStateChanged(clientId: string, agentId: string): Promise<void> {
    const userIds = await this.resolveUserIdsToNotify(clientId);

    await Promise.all(userIds.map((userId) => this.pushPatchForUser(userId, clientId, agentId)));
  }

  private async notifyChatActivity(
    clientId: string,
    agentId: string,
    chatSessionId: string | null,
    activityAt: Date,
  ): Promise<void> {
    const userIds = await this.resolveUserIdsToNotify(clientId);
    const latest = chatSessionId
      ? await this.messagesProxy.getLatestAgentMessage(clientId, agentId, chatSessionId)
      : await this.messagesProxy.getLatestAgentMessage(clientId, agentId);
    const latestAt = latest?.createdAt ? new Date(latest.createdAt) : null;
    const readAt = this.maxDate(activityAt, latestAt) ?? activityAt;

    for (const userId of userIds) {
      const activeForUser = this.findActiveEnvironmentForUser(userId, clientId, agentId, chatSessionId);

      if (activeForUser) {
        await this.readStateRepository.upsertReadState({
          userId,
          clientId,
          agentId,
          lastReadAt: readAt,
          // Keep prior message id when latest is unknown — never wipe a successful mark-read.
          ...(latest?.id ? { lastReadAgentMessageId: latest.id } : {}),
        });

        if (chatSessionId) {
          await this.chatReadStateRepository.upsertReadState({
            userId,
            clientId,
            agentId,
            chatSessionId,
            lastReadAt: readAt,
            ...(latest?.id ? { lastReadAgentMessageId: latest.id } : {}),
          });
        }
      }

      await this.pushPatchForUser(userId, clientId, agentId);
    }
  }

  isActiveEnvironmentForSocket(socketId: string, clientId: string, agentId: string): boolean {
    const active = this.activeEnvironmentBySocketId.get(socketId);

    return active?.clientId === clientId && active?.agentId === agentId;
  }

  private findActiveEnvironmentForUser(
    userId: string,
    clientId: string,
    agentId: string,
    chatSessionId: string | null,
  ): boolean {
    for (const [socketId, active] of this.activeEnvironmentBySocketId.entries()) {
      if (!active || active.clientId !== clientId || active.agentId !== agentId) {
        continue;
      }

      if (this.realtime.getUserIdForSocket(socketId) !== userId) {
        continue;
      }

      // No chat attribution (legacy): suppress when environment is active.
      if (!chatSessionId) {
        return true;
      }

      // Only auto-clear when the client explicitly claims this chat as active.
      // null active.chatSessionId must not imply primary — that hid primary unread while loading
      // or after setActiveEnvironment(client, agent) without a chat id.
      return active.chatSessionId === chatSessionId;
    }

    return false;
  }

  private async resolvePrimaryChatId(clientId: string, agentId: string): Promise<string | null> {
    try {
      const agents = await this.agentProxy.getClientAgents(clientId, 1000, 0);
      const agent = agents.find((a) => a.id === agentId) as AgentResponseDto | undefined;

      if (!agent) {
        return null;
      }

      if (agent.primaryChatId) {
        return agent.primaryChatId;
      }

      return agent.chats?.find((c) => c.kind === 'primary')?.id ?? agent.chats?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async pushPatchForUser(userId: string, clientId: string, agentId: string): Promise<void> {
    const env = await this.buildEnvironmentStatus(userId, clientId, agentId);

    if (!env) {
      return;
    }

    const patch: StatusPatchPayload = {
      generatedAt: new Date().toISOString(),
      environments: [env],
    };

    this.realtime.emitToUser(userId, 'statusPatch', patch);
  }

  private async buildEnvironmentProgress(clientIds: string[]): Promise<ClientEnvironmentProgressPayload[]> {
    const results = await Promise.all(
      clientIds.map(async (clientId) => {
        try {
          const operations = await this.agentProxy.getClientEnvironmentProgress(clientId);

          return { clientId, operations: operations.filter((op) => op.status === 'running') };
        } catch (error) {
          this.logger.debug(`Skipping environment progress for client ${clientId}: ${(error as Error).message}`);

          return { clientId, operations: [] };
        }
      }),
    );

    return results.filter((entry) => entry.operations.length > 0);
  }

  private async buildEnvironmentsForUser(userId: string, clientIds: string[]): Promise<EnvironmentStatusPayload[]> {
    type PendingEnv = {
      clientId: string;
      agentId: string;
      gitDirty: boolean;
      gitConflict: boolean;
      visibleChats: Array<{ id: string; kind: string }>;
      primaryChatId: string | null;
      latestAutomationAt: Date | null;
    };

    const pending: PendingEnv[] = [];
    const vcsConcurrency = this.getVcsConcurrency();

    // Phase 1: resolve agents + slow VCS. Unread is computed afterward so a mark-read
    // that lands during VCS cannot be overwritten by a stale pre-mark read snapshot.
    for (const clientId of clientIds) {
      let agents: AgentResponseDto[] = [];

      try {
        agents = await this.agentProxy.getClientAgents(clientId, 1000, 0);
      } catch (error) {
        this.logger.debug(`Skipping agents for client ${clientId}: ${(error as Error).message}`);

        continue;
      }

      const automationByAgent = await this.automationRunsStatusRepository.findLatestUpdatedAtByClient(clientId);

      for (let i = 0; i < agents.length; i += vcsConcurrency) {
        const chunk = agents.slice(i, i + vcsConcurrency);
        const chunkResults = await Promise.all(
          chunk.map(async (agent) => {
            const visibleChats = (agent.chats ?? [])
              .filter((c) => c.kind === 'primary' || c.kind === 'user')
              .map((c) => ({ id: c.id, kind: c.kind }));
            const primaryChatId = agent.primaryChatId ?? visibleChats.find((c) => c.kind === 'primary')?.id ?? null;
            const latestAutomationAt = automationByAgent.get(agent.id) ?? null;
            let gitDirty = false;
            let gitConflict = false;

            try {
              const gitStatus = await this.vcsProxy.getStatus(clientId, agent.id);
              const mapped = mapGitStatus(gitStatus);

              gitDirty = mapped.gitDirty;
              gitConflict = mapped.gitConflict;
            } catch {
              // Agent offline or VCS unavailable
            }

            return {
              clientId,
              agentId: agent.id,
              gitDirty,
              gitConflict,
              visibleChats,
              primaryChatId,
              latestAutomationAt,
            } satisfies PendingEnv;
          }),
        );

        pending.push(...chunkResults);
      }
    }

    // Phase 2: fresh read cursors + latest messages (after any concurrent mark-read).
    const chatReadStates = await this.chatReadStateRepository.findByUserAndClientIds(userId, clientIds);
    const chatReadByKey = new Map<string, (typeof chatReadStates)[0]>();

    for (const row of chatReadStates) {
      chatReadByKey.set(`${row.clientId}:${row.agentId}:${row.chatSessionId}`, row);
    }

    return await Promise.all(
      pending.map(async (item) => {
        const chatStatuses: ChatSessionStatusPayload[] = await Promise.all(
          item.visibleChats.map(async (chat) => {
            const latestAgentMsg = await this.messagesProxy.getLatestAgentMessage(item.clientId, item.agentId, chat.id);
            const latestAgentAt = latestAgentMsg ? new Date(latestAgentMsg.createdAt) : null;
            const isPrimary = chat.kind === 'primary' || chat.id === item.primaryChatId;
            const readState = chatReadByKey.get(`${item.clientId}:${item.agentId}:${chat.id}`);
            const lastReadAt = readState?.lastReadAt ?? null;
            const lastReadMessageId = readState?.lastReadAgentMessageId ?? null;

            // Prefer message-id equality so clock skew / auto-clear races cannot revive unread.
            let messageUnread = false;

            if (latestAgentMsg) {
              if (lastReadMessageId && lastReadMessageId === latestAgentMsg.id) {
                messageUnread = false;
              } else {
                messageUnread = lastReadAt === null || (latestAgentAt !== null && latestAgentAt > lastReadAt);
              }
            }

            const automationUnread =
              isPrimary &&
              item.latestAutomationAt !== null &&
              (lastReadAt === null || item.latestAutomationAt > lastReadAt);
            const hasUnreadMessages = messageUnread || Boolean(automationUnread);

            return {
              chatSessionId: chat.id,
              hasUnreadMessages,
            };
          }),
        );

        return {
          clientId: item.clientId,
          agentId: item.agentId,
          hasUnreadMessages: chatStatuses.some((c) => c.hasUnreadMessages),
          gitDirty: item.gitDirty,
          gitConflict: item.gitConflict,
          chats: chatStatuses,
        } satisfies EnvironmentStatusPayload;
      }),
    );
  }

  private async buildEnvironmentStatus(
    userId: string,
    clientId: string,
    agentId: string,
  ): Promise<EnvironmentStatusPayload | null> {
    const rows = await this.buildEnvironmentsForUser(userId, [clientId]);

    return rows.find((r) => r.agentId === agentId) ?? null;
  }

  private diffSnapshots(
    previous: StatusSnapshotPayload | undefined,
    next: StatusSnapshotPayload,
  ): StatusPatchPayload | null {
    if (!previous) {
      return {
        generatedAt: next.generatedAt,
        environments: next.environments,
        clients: next.clients,
        spacesHasAttention: next.spacesHasAttention,
        environmentProgress: next.environmentProgress,
      };
    }

    const prevEnvMap = new Map(previous.environments.map((e) => [`${e.clientId}:${e.agentId}`, e]));
    const changedEnvs: EnvironmentStatusPayload[] = [];

    for (const env of next.environments) {
      const key = `${env.clientId}:${env.agentId}`;
      const prev = prevEnvMap.get(key);

      if (
        !prev ||
        prev.hasUnreadMessages !== env.hasUnreadMessages ||
        prev.gitDirty !== env.gitDirty ||
        prev.gitConflict !== env.gitConflict ||
        !chatsEqual(prev.chats, env.chats)
      ) {
        changedEnvs.push(env);
      }
    }

    const prevClients = new Map(previous.clients.map((c) => [c.clientId, c]));
    const changedClients: ClientStatusPayload[] = [];

    for (const client of next.clients) {
      const prev = prevClients.get(client.clientId);

      if (!prev || prev.hasUnreadMessages !== client.hasUnreadMessages || prev.gitDirty !== client.gitDirty) {
        changedClients.push(client);
      }
    }

    const attentionChanged = previous.spacesHasAttention !== next.spacesHasAttention;
    const changedProgress = diffEnvironmentProgress(previous.environmentProgress, next.environmentProgress);

    if (changedEnvs.length === 0 && changedClients.length === 0 && !attentionChanged && changedProgress.length === 0) {
      return null;
    }

    return {
      generatedAt: next.generatedAt,
      environments: changedEnvs.length ? changedEnvs : undefined,
      clients: changedClients.length ? changedClients : undefined,
      spacesHasAttention: attentionChanged ? next.spacesHasAttention : undefined,
      environmentProgress: changedProgress.length ? changedProgress : undefined,
    };
  }

  private async getUserIdsWithClientAccess(clientId: string): Promise<string[]> {
    const client = await this.clientsRepository.findById(clientId);
    const userIds = new Set<string>();

    if (client?.userId) {
      userIds.add(client.userId);
    }

    const members = await this.clientUsersRepository.findByClientId(clientId);

    for (const member of members) {
      userIds.add(member.userId);
    }

    if (userIds.size === 0 && process.env.STATIC_API_KEY) {
      userIds.add('api-key-user');
    }

    return [...userIds];
  }

  /**
   * Workspace owner, client_users members, and any connected status user who has access
   * (e.g. global admins) — aligned with ensureClientAccess / chat visibility.
   */
  private async resolveUserIdsToNotify(clientId: string): Promise<string[]> {
    const userIds = new Set(await this.getUserIdsWithClientAccess(clientId));

    for (const connectedUserId of this.realtime.getConnectedUserIds()) {
      if (userIds.has(connectedUserId)) {
        continue;
      }

      const userRole = this.realtime.getUserRole(connectedUserId) ?? UserRole.USER;
      const { hasAccess } = await checkClientAccess(
        this.clientsRepository,
        this.clientUsersRepository,
        clientId,
        connectedUserId,
        userRole,
        false,
      );

      if (hasAccess) {
        userIds.add(connectedUserId);
      }
    }

    return [...userIds];
  }

  private maxDate(a: Date | null, b: Date | null): Date | null {
    if (!a) {
      return b;
    }

    if (!b) {
      return a;
    }

    return a > b ? a : b;
  }

  private getVcsConcurrency(): number {
    const raw = parseInt(process.env.STATUS_VCS_CONCURRENCY || String(DEFAULT_VCS_CONCURRENCY), 10);

    return Number.isNaN(raw) || raw < 1 ? DEFAULT_VCS_CONCURRENCY : Math.min(raw, 10);
  }
}
