import {
  AGENT_HANDOFF_CHAT_SESSION_KIND,
  AGENT_HANDOFF_LIMITS,
  type AgentHandoffAgentSummary,
  type AgentHandoffCreateInput,
  type AgentHandoffRespondInput,
  type AgentHandoffSummary,
} from '@forepath/agenstra/shared/util-opencode-config';
import { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';

import { getAgentHandoffMaxDepth, getAgentHandoffsMaxActivePerWorkspace } from '../constants/agent-handoffs.constants';
import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { AGENSTRA_CONTROLLER_QUEUE_NAME } from '../modules/agenstra-notifications.module';
import { agentHandoffEntityToSummary } from '../utils/agent-handoff-mappers';
import { enqueueAgentHandoff } from '../utils/agent-handoff-queue.utils';
import { assertValidPreferredModel } from '../utils/preferred-model.utils';

import { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';

/** Agents listed by `handoff_agents` (workspaces rarely have more). */
const HANDOFF_AGENTS_LIST_LIMIT = 100;

const AGENT_NAME_MAX_LENGTH = 255;

/**
 * Handoffs between agents of one workspace. Every entry point is called by
 * {@link AgentHandoffRequestHandlerService} with the workspace bound to the manager connection and the agent the
 * manager authenticated, so an agent can only reach agents of its own workspace and only sees handoffs it sent or
 * received. Handoffs of other agents or workspaces are indistinguishable from missing ones.
 */
@Injectable()
export class AgentHandoffsService {
  private readonly logger = new Logger(AgentHandoffsService.name);

  constructor(
    @InjectRepository(AgentHandoffEntity)
    private readonly handoffRepo: Repository<AgentHandoffEntity>,
    private readonly clientAgentCredentialsRepository: ClientAgentCredentialsRepository,
    private readonly agentProxy: ClientAgentProxyService,
    private readonly chatsProxy: ClientAgentChatsProxyService,
    @Optional() @InjectQueue(AGENSTRA_CONTROLLER_QUEUE_NAME) private readonly controllerQueue?: Queue,
  ) {}

  /** Other agents of the workspace (the controller only knows workspace agents by their stored credentials). */
  async listAgentsForAgent(clientId: string, agentId: string): Promise<AgentHandoffAgentSummary[]> {
    const agents = await this.agentProxy.getClientAgents(clientId, HANDOFF_AGENTS_LIST_LIMIT, 0);
    const out: AgentHandoffAgentSummary[] = [];

    for (const agent of agents) {
      if (agent.id === agentId || !(await this.isWorkspaceAgent(clientId, agent.id))) {
        continue;
      }

      out.push({
        id: agent.id,
        name: agent.name,
        ...(agent.description ? { description: agent.description } : {}),
        ...(agent.handoffProfile ? { handoffProfile: agent.handoffProfile } : {}),
        ...(agent.containerType ? { containerType: agent.containerType } : {}),
        ...(agent.git?.repositoryUrl ? { repositoryUrl: agent.git.repositoryUrl } : {}),
      });
    }

    return out;
  }

  /**
   * `sourceChatId` is the visible chat the manager attributed the call to; the response is delivered there only.
   * Every refusal is reported to the calling agent (MCP tool error) so it can decide how to continue.
   */
  async createForAgent(
    clientId: string,
    sourceAgentId: string,
    sourceChatId: string,
    input: AgentHandoffCreateInput,
    sourceModel?: string,
  ): Promise<AgentHandoffSummary> {
    const targetAgentId = (input.targetAgentId ?? '').trim().toLowerCase();

    if (targetAgentId === sourceAgentId) {
      throw new BadRequestException('Hand the task to another agent; you cannot hand off to yourself');
    }

    if (!(await this.isWorkspaceAgent(clientId, targetAgentId))) {
      throw new NotFoundException('Target agent not found in this workspace');
    }

    const title = this.requireText(input.title, 'title', AGENT_HANDOFF_LIMITS.titleMaxLength);
    const message = this.requireText(input.message, 'message', AGENT_HANDOFF_LIMITS.messageMaxLength);
    const model = assertValidPreferredModel(input.model);
    // Best effort: an unusable model of the requesting chat falls back to the agent's default for the delivery turn.
    const validSourceModel = (() => {
      try {
        return assertValidPreferredModel(sourceModel);
      } catch {
        return null;
      }
    })();

    if (!this.controllerQueue) {
      throw new ServiceUnavailableException('Handoffs are unavailable (queue not configured)');
    }

    const active = await this.handoffRepo.count({ where: { clientId, status: In(['pending', 'running']) } });

    if (active >= getAgentHandoffsMaxActivePerWorkspace()) {
      throw new ConflictException(
        `This workspace already has ${active} open handoffs; wait for responses before handing off more tasks`,
      );
    }

    // A handoff chat handing the task on makes this handoff part of a chain.
    const parent = await this.handoffRepo.findOne({
      where: { clientId, targetAgentId: sourceAgentId, targetChatId: sourceChatId },
    });
    const depth = parent ? parent.depth + 1 : 1;

    if (depth > getAgentHandoffMaxDepth()) {
      throw new ConflictException(
        `This task was already handed over ${depth - 1} times; it cannot be handed over again. Finish it yourself.`,
      );
    }

    const [source, target] = await Promise.all([
      this.agentProxy.getClientAgent(clientId, sourceAgentId),
      this.getTargetAgent(clientId, targetAgentId),
    ]);
    const chat = await this.chatsProxy.create(clientId, targetAgentId, {
      title,
      kind: AGENT_HANDOFF_CHAT_SESSION_KIND,
    });
    const saved = await this.handoffRepo.save(
      this.handoffRepo.create({
        clientId,
        sourceAgentId,
        sourceAgentName: this.agentName(source.name),
        sourceChatId,
        parentHandoffId: parent?.id ?? null,
        targetAgentId,
        targetAgentName: this.agentName(target.name),
        targetChatId: chat.id,
        title,
        message,
        model,
        sourceModel: validSourceModel,
        status: 'pending',
        depth,
        deliveryAttempts: 0,
      }),
    );

    try {
      await enqueueAgentHandoff(this.controllerQueue, { handoffId: saved.id });
    } catch (error) {
      // The coordinator re-enqueues pending handoffs; the caller still gets its handoff.
      this.logger.warn(`Handoff ${saved.id}: enqueue failed, coordinator retries: ${(error as Error).message}`);
    }

    return agentHandoffEntityToSummary(saved);
  }

  async getForAgent(clientId: string, agentId: string, handoffId: string): Promise<AgentHandoffSummary> {
    const handoff = await this.handoffRepo.findOne({
      where: [
        { id: handoffId, clientId, sourceAgentId: agentId },
        { id: handoffId, clientId, targetAgentId: agentId },
      ],
    });

    if (!handoff) {
      throw new NotFoundException('Handoff not found');
    }

    return agentHandoffEntityToSummary(handoff);
  }

  /** Only the target answers, once. Delivery to the source happens when the target turn ended. */
  async respondForAgent(
    clientId: string,
    agentId: string,
    handoffId: string,
    input: AgentHandoffRespondInput,
  ): Promise<AgentHandoffSummary> {
    const handoff = await this.handoffRepo.findOne({ where: { id: handoffId, clientId, targetAgentId: agentId } });

    if (!handoff) {
      throw new NotFoundException('Handoff not found');
    }

    const response = this.requireText(input.response, 'response', AGENT_HANDOFF_LIMITS.responseMaxLength);
    const patch = { status: input.status, response, finishedAt: new Date() };
    const result = await this.handoffRepo.update({ id: handoff.id, status: In(['pending', 'running']) }, patch);

    if (!result.affected) {
      throw new ConflictException('This handoff has already been answered');
    }

    return agentHandoffEntityToSummary({ ...handoff, ...patch });
  }

  /** Registered in the workspace but gone on the manager (deleted environment) counts as missing as well. */
  private async getTargetAgent(clientId: string, targetAgentId: string) {
    try {
      return await this.agentProxy.getClientAgent(clientId, targetAgentId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Target agent not found in this workspace');
      }

      throw error;
    }
  }

  private async isWorkspaceAgent(clientId: string, agentId: string): Promise<boolean> {
    return !!agentId && !!(await this.clientAgentCredentialsRepository.findByClientAndAgent(clientId, agentId));
  }

  private agentName(name: string | undefined): string {
    return (name?.trim() || 'Agent').slice(0, AGENT_NAME_MAX_LENGTH);
  }

  private requireText(value: string | undefined, field: string, maxLength: number): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';

    if (!trimmed) {
      throw new BadRequestException(`${field} is required`);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
    }

    return trimmed;
  }
}
