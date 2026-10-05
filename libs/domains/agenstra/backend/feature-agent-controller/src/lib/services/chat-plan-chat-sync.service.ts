import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import type { ChatPlanChatEventDto } from '../dto/chat-plan/chat-plan-chat-event.dto';
import { ChatPlanEntity } from '../entities/chat-plan.entity';
import { ChatPlanStatus } from '../entities/chat-plan.enums';
import { chatPlanEntityToDto } from '../utils/chat-plan-mappers';

import { AgentConsoleStatusService } from './agent-console-status.service';
import { ChatPlanRealtimeService } from './chat-plan-realtime.service';

/** Cap for post-login hydration (per agent + client). */
export const CHAT_PLAN_HYDRATE_LIMIT = 100;

/** Only hydrate plans started within this window. */
export const CHAT_PLAN_HYDRATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const OPEN_PLAN_LABEL = 'View plan';
const EXECUTE_PLAN_LABEL = 'Execute plan';

@Injectable()
export class ChatPlanChatSyncService {
  private readonly logger = new Logger(ChatPlanChatSyncService.name);

  constructor(
    @InjectRepository(ChatPlanEntity)
    private readonly planRepo: Repository<ChatPlanEntity>,
    private readonly chatPlanRealtime: ChatPlanRealtimeService,
    private readonly agentConsoleStatusService: AgentConsoleStatusService,
  ) {}

  /**
   * After agent login: replay plan snapshots for this client+agent (unicast), oldest first.
   */
  async hydrateForAgentClient(socket: Socket, clientId: string, agentId: string): Promise<void> {
    const cutoff = new Date(Date.now() - CHAT_PLAN_HYDRATE_MAX_AGE_MS);
    const plans = await this.planRepo
      .createQueryBuilder('p')
      .where('p.client_id = :clientId', { clientId })
      .andWhere('p.agent_id = :agentId', { agentId })
      .andWhere('p.started_at >= :cutoff', { cutoff })
      .orderBy('p.started_at', 'ASC')
      .take(CHAT_PLAN_HYDRATE_LIMIT)
      .getMany();

    for (const plan of plans) {
      this.chatPlanRealtime.emitToSocket(socket, this.buildPayload(plan, true));
    }

    this.logger.debug(`Hydrated ${plans.length} chat plan(s), client=${clientId} agent=${agentId}`);
  }

  /** Live plan snapshot to all sockets in the client room. */
  async emitLiveUpdateByPlanId(planId: string): Promise<void> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });

    if (!plan) {
      return;
    }

    this.emitLiveUpdateFromEntity(plan);
  }

  /** Live update when plan entity is already loaded and saved. */
  emitLiveUpdateFromEntity(plan: ChatPlanEntity): void {
    this.chatPlanRealtime.emitToClient(plan.clientId, this.buildPayload(plan, false));
    void this.agentConsoleStatusService
      .onAutomationChatActivity(plan.clientId, plan.agentId, plan.updatedAt)
      .catch(() => undefined);
  }

  private buildPayload(plan: ChatPlanEntity, hydrate: boolean): ChatPlanChatEventDto {
    const planDto = chatPlanEntityToDto(plan);
    const timelineAt = hydrate ? plan.startedAt.toISOString() : plan.updatedAt.toISOString();
    const actions: ChatPlanChatEventDto['actions'] = [
      {
        type: 'openChatPlan',
        planId: plan.id,
        chatId: plan.chatId,
        label: OPEN_PLAN_LABEL,
      },
    ];

    if (plan.status === ChatPlanStatus.READY) {
      actions.push({
        type: 'executeChatPlan',
        planId: plan.id,
        chatId: plan.chatId,
        label: EXECUTE_PLAN_LABEL,
      });
    }

    return {
      timelineAt,
      hydrate,
      plan: planDto,
      actions,
    };
  }
}
