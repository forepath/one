import { GitStatusDto } from '@forepath/agenstra/backend/feature-agent-manager';
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
  ClientStatusPayload,
  EnvironmentStatusPayload,
  StatusPatchPayload,
  StatusSnapshotPayload,
} from '../dto/agent-console-status.dto';
import { ClientsRepository } from '../repositories/clients.repository';
import { TicketAutomationRunsStatusRepository } from '../repositories/ticket-automation-runs-status.repository';
import { UserEnvironmentReadStateRepository } from '../repositories/user-environment-read-state.repository';

import { AgentConsoleStatusRealtimeService } from './agent-console-status-realtime.service';
import { ClientAgentMessagesProxyService } from './client-agent-messages-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { ClientAgentVcsProxyService } from './client-agent-vcs-proxy.service';
import { ClientsService } from './clients.service';

const DEFAULT_VCS_CONCURRENCY = 3;

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

@Injectable()
export class AgentConsoleStatusService {
  private readonly logger = new Logger(AgentConsoleStatusService.name);
  private readonly activeEnvironmentBySocketId = new Map<string, { clientId: string; agentId: string } | null>();
  private readonly lastSnapshotBySocketId = new Map<string, StatusSnapshotPayload>();

  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly readStateRepository: UserEnvironmentReadStateRepository,
    private readonly automationRunsStatusRepository: TicketAutomationRunsStatusRepository,
    private readonly messagesProxy: ClientAgentMessagesProxyService,
    @Inject(forwardRef(() => ClientAgentVcsProxyService))
    private readonly vcsProxy: ClientAgentVcsProxyService,
    private readonly agentProxy: ClientAgentProxyService,
    private readonly realtime: AgentConsoleStatusRealtimeService,
  ) {}

  setActiveEnvironment(socketId: string, clientId: string | null, agentId: string | null): void {
    if (!clientId || !agentId) {
      this.activeEnvironmentBySocketId.set(socketId, null);

      return;
    }

    this.activeEnvironmentBySocketId.set(socketId, { clientId, agentId });
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

  async markEnvironmentRead(userInfo: SocketUserInfo, clientId: string, agentId: string): Promise<void> {
    const userId = resolveUserId(userInfo);

    if (!userId) {
      return;
    }

    await this.assertEnvironmentAccess(userInfo, clientId, agentId);

    const latest = await this.messagesProxy.getLatestAgentMessage(clientId, agentId);

    await this.readStateRepository.upsertReadState({
      userId,
      clientId,
      agentId,
      lastReadAt: new Date(),
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
    const environments = await this.buildEnvironmentsForUser(userId, clientIds);
    const clients = rollupClients(environments);

    return {
      generatedAt: new Date().toISOString(),
      environments,
      clients,
      spacesHasAttention: spacesHasAttention(clients),
    };
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

  async onAgentChatActivity(clientId: string, agentId: string, activityAt = new Date()): Promise<void> {
    await this.notifyEnvironmentActivity(clientId, agentId, activityAt);
  }

  async onAutomationChatActivity(clientId: string, agentId: string, activityAt = new Date()): Promise<void> {
    await this.notifyEnvironmentActivity(clientId, agentId, activityAt);
  }

  /**
   * Pushes a status patch after git state changes (VCS mutations).
   * Notifies every user with access to the workspace, same as chat activity hooks.
   */
  async notifyVcsStateChanged(clientId: string, agentId: string): Promise<void> {
    const userIds = await this.resolveUserIdsToNotify(clientId);

    await Promise.all(userIds.map((userId) => this.pushPatchForUser(userId, clientId, agentId)));
  }

  private async notifyEnvironmentActivity(clientId: string, agentId: string, activityAt: Date): Promise<void> {
    const userIds = await this.resolveUserIdsToNotify(clientId);

    for (const userId of userIds) {
      const readState = await this.readStateRepository.findOne(userId, clientId, agentId);
      const activeForUser = this.findActiveEnvironmentForUser(userId, clientId, agentId);

      if (activeForUser) {
        await this.readStateRepository.upsertReadState({
          userId,
          clientId,
          agentId,
          lastReadAt: activityAt,
          lastReadAgentMessageId: readState?.lastReadAgentMessageId ?? null,
        });
      }

      await this.pushPatchForUser(userId, clientId, agentId);
    }
  }

  isActiveEnvironmentForSocket(socketId: string, clientId: string, agentId: string): boolean {
    const active = this.activeEnvironmentBySocketId.get(socketId);

    return active?.clientId === clientId && active?.agentId === agentId;
  }

  private findActiveEnvironmentForUser(userId: string, clientId: string, agentId: string): boolean {
    for (const [socketId, active] of this.activeEnvironmentBySocketId.entries()) {
      if (!active || active.clientId !== clientId || active.agentId !== agentId) {
        continue;
      }

      if (this.realtime.getUserIdForSocket(socketId) === userId) {
        return true;
      }
    }

    return false;
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

  private async buildEnvironmentsForUser(userId: string, clientIds: string[]): Promise<EnvironmentStatusPayload[]> {
    const readStates = await this.readStateRepository.findByUserAndClientIds(userId, clientIds);
    const readByKey = new Map<string, (typeof readStates)[0]>();

    for (const row of readStates) {
      readByKey.set(`${row.clientId}:${row.agentId}`, row);
    }

    const environments: EnvironmentStatusPayload[] = [];
    const vcsConcurrency = this.getVcsConcurrency();

    for (const clientId of clientIds) {
      let agents: { id: string }[] = [];

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
            const readState = readByKey.get(`${clientId}:${agent.id}`);
            const latestAgentMsg = await this.messagesProxy.getLatestAgentMessage(clientId, agent.id);
            const latestAutomationAt = automationByAgent.get(agent.id) ?? null;
            const latestAgentAt = latestAgentMsg ? new Date(latestAgentMsg.createdAt) : null;
            const latestActivityAt = this.maxDate(latestAgentAt, latestAutomationAt);
            const lastReadAt = readState?.lastReadAt ?? null;
            const hasUnreadMessages =
              latestActivityAt !== null && (lastReadAt === null || latestActivityAt > lastReadAt);
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
              hasUnreadMessages,
              gitDirty,
              gitConflict,
            } satisfies EnvironmentStatusPayload;
          }),
        );

        environments.push(...chunkResults);
      }
    }

    return environments;
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
        prev.gitConflict !== env.gitConflict
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

    if (changedEnvs.length === 0 && changedClients.length === 0 && !attentionChanged) {
      return null;
    }

    return {
      generatedAt: next.generatedAt,
      environments: changedEnvs.length ? changedEnvs : undefined,
      clients: changedClients.length ? changedClients : undefined,
      spacesHasAttention: attentionChanged ? next.spacesHasAttention : undefined,
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
