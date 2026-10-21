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
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { EntityManager, In, IsNull, MoreThan, Repository } from 'typeorm';

import {
  getAgentHandoffMaxDepth,
  getAgentHandoffsMaxActivePerWorkspace,
  getAgentHandoffTurnTimeoutMs,
} from '../constants/agent-handoffs.constants';
import { getAgentTaskRunMaxHandoffs } from '../constants/agent-tasks.constants';
import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
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
 * Where a handoff is made (resolved by the manager from the calling agent's single working context, never from model
 * input): a visible chat, or the hidden session of a task's run (`taskId`; the run is the task's running run).
 */
export type AgentHandoffSource = { kind: 'chat'; chatId: string } | { kind: 'taskRun'; taskId: string };

type HandoffSourceColumns = Pick<
  AgentHandoffEntity,
  'sourceChatId' | 'sourceTaskId' | 'sourceTaskRunId' | 'parentHandoffId' | 'depth' | 'sourceModel'
>;

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
   * `source` is the visible chat or task run the manager attributed the call to; the response is delivered there
   * only. Task runs may only hand off to the agents a user approved for the task, one open handoff at a time and a
   * bounded number per run. Every refusal is reported to the calling agent (MCP tool error) so it can decide how to
   * continue.
   */
  async createForAgent(
    clientId: string,
    sourceAgentId: string,
    source: AgentHandoffSource,
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

    const fields = { clientId, sourceAgentId, targetAgentId, title, message, model };
    let saved: AgentHandoffEntity;

    if (source.kind === 'chat') {
      const parent = await this.findChainParent(clientId, sourceAgentId, source.chatId);
      const depth = parent ? parent.depth + 1 : 1;

      if (depth > getAgentHandoffMaxDepth()) {
        throw new ConflictException(
          `This task was already handed over ${depth - 1} times; it cannot be handed over again. Finish it yourself.`,
        );
      }

      saved = await this.persist(this.handoffRepo, fields, {
        sourceChatId: source.chatId,
        sourceTaskId: null,
        sourceTaskRunId: null,
        parentHandoffId: parent?.id ?? null,
        depth,
        sourceModel: validSourceModel,
      });
    } else {
      // The run row stays locked until the handoff is stored: concurrent calls of one run see each other.
      saved = await this.handoffRepo.manager.transaction(async (em) => {
        const { task, run } = await this.lockApprovedTaskRun(em, clientId, sourceAgentId, source.taskId, targetAgentId);

        return this.persist(em.getRepository(AgentHandoffEntity), fields, {
          sourceChatId: null,
          sourceTaskId: task.id,
          sourceTaskRunId: run.id,
          // Never part of a chain: the target's handoff chat cannot hand it on (see findChainParent).
          parentHandoffId: null,
          depth: 1,
          sourceModel: task.model,
        });
      });
    }

    try {
      await enqueueAgentHandoff(this.controllerQueue, { handoffId: saved.id });
    } catch (error) {
      // The coordinator re-enqueues pending handoffs; the caller still gets its handoff.
      this.logger.warn(`Handoff ${saved.id}: enqueue failed, coordinator retries: ${(error as Error).message}`);
    }

    return agentHandoffEntityToSummary(saved);
  }

  /** Target chat on the target agent plus the stored handoff (pending; the unit job runs it). */
  private async persist(
    repo: Repository<AgentHandoffEntity>,
    fields: {
      clientId: string;
      sourceAgentId: string;
      targetAgentId: string;
      title: string;
      message: string;
      model: string | null;
    },
    source: HandoffSourceColumns,
  ): Promise<AgentHandoffEntity> {
    const [sourceAgent, target] = await Promise.all([
      this.agentProxy.getClientAgent(fields.clientId, fields.sourceAgentId),
      this.getTargetAgent(fields.clientId, fields.targetAgentId),
    ]);
    const chat = await this.chatsProxy.create(fields.clientId, fields.targetAgentId, {
      title: fields.title,
      kind: AGENT_HANDOFF_CHAT_SESSION_KIND,
    });

    return repo.save(
      repo.create({
        ...fields,
        ...source,
        sourceAgentName: this.agentName(sourceAgent.name),
        targetAgentName: this.agentName(target.name),
        targetChatId: chat.id,
        status: 'pending',
        deliveryAttempts: 0,
      }),
    );
  }

  /**
   * The task run a hidden task session belongs to, with every precondition of a handoff from it: the task is this
   * agent's, approved, has a running run (locked for the rest of the transaction), lists the target among its
   * approved handoff agents, has no other open handoff and has not used up its handoffs.
   */
  private async lockApprovedTaskRun(
    em: EntityManager,
    clientId: string,
    sourceAgentId: string,
    taskId: string,
    targetAgentId: string,
  ): Promise<{ task: AgentTaskEntity; run: AgentTaskRunEntity }> {
    const task = await em
      .getRepository(AgentTaskEntity)
      .findOne({ where: { id: taskId, clientId, agentId: sourceAgentId } });

    if (!task) {
      throw new BadRequestException(
        'Handoffs are only available in visible chats and in runs of approved scheduled tasks.',
      );
    }

    if (!task.approvedAt) {
      throw new ConflictException(
        'This task waits for approval by a workspace user; its runs cannot hand off work until then.',
      );
    }

    const run = await em
      .getRepository(AgentTaskRunEntity)
      .createQueryBuilder('r')
      .setLock('pessimistic_write')
      .where('r.task_id = :taskId', { taskId: task.id })
      .andWhere("r.status = 'running'")
      .getOne();

    if (!run) {
      throw new ConflictException('This task run is not working anymore; handoffs can only be made while it works.');
    }

    const allowed = task.allowedHandoffAgentIds ?? [];

    if (!allowed.includes(targetAgentId)) {
      throw new ForbiddenException(
        allowed.length
          ? `A user approved this task to hand off only to these agents: ${allowed.join(', ')}. Hand off to one of ` +
            'them or do the work yourself.'
          : 'No agents were approved for handoffs from this task. Do the work yourself, or propose ' +
            'allowedHandoffAgentIds with agenstra_tasks_update (a user has to approve the task again).',
      );
    }

    const handoffs = em.getRepository(AgentHandoffEntity);
    const open = await handoffs.findOne({
      where: { sourceTaskRunId: run.id, deliveredAt: IsNull(), deliveryFailureMessage: IsNull() },
    });

    if (open) {
      throw new ConflictException(
        `This run already waits for the response to the handoff ${JSON.stringify(open.title)} (handoffId ` +
          `"${open.id}"). End your turn; the response arrives in this session.`,
      );
    }

    const max = getAgentTaskRunMaxHandoffs();

    if ((await handoffs.count({ where: { sourceTaskRunId: run.id } })) >= max) {
      throw new ConflictException(`A task run can hand off at most ${max} times; finish this run yourself.`);
    }

    return { task, run };
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

  /**
   * The handoff this one continues, if any:
   * - the source chat is a handoff chat (the target hands the task on), or
   * - the source chat is still in the turn a delivered handoff response started (the requester reacts to an answer —
   *   without this, two agents could hand work back and forth forever at depth 1). Later, unrelated handoffs in the
   *   same chat start a new chain.
   * The deeper of both counts.
   */
  private async findChainParent(
    clientId: string,
    sourceAgentId: string,
    sourceChatId: string,
  ): Promise<AgentHandoffEntity | null> {
    const [received, answered] = await Promise.all([
      this.handoffRepo.findOne({ where: { clientId, targetAgentId: sourceAgentId, targetChatId: sourceChatId } }),
      this.handoffRepo.findOne({
        where: {
          clientId,
          sourceAgentId,
          sourceChatId,
          deliveredAt: MoreThan(new Date(Date.now() - getAgentHandoffTurnTimeoutMs())),
          deliveryTurnEndedAt: IsNull(),
        },
        order: { depth: 'DESC', deliveredAt: 'DESC' },
      }),
    ]);

    // Handed over by an unattended task run: the user approved that run's targets, not further hops.
    if (received?.sourceTaskRunId) {
      throw new ConflictException(
        `This task was handed over by a scheduled task run of ${JSON.stringify(received.sourceAgentName)}; it ` +
          'cannot be handed over again. Finish it yourself.',
      );
    }

    if (received && answered) {
      return received.depth >= answered.depth ? received : answered;
    }

    return received ?? answered ?? null;
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
