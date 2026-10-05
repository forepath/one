import {
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { ChatPlanResponseDto } from '../dto/chat-plan';
import { ChatPlanEntity, type ChatPlanContextInjectionJson } from '../entities/chat-plan.entity';
import {
  CHAT_PLAN_ACTIVE_STATUSES,
  ChatPlanFailureCode,
  ChatPlanPhase,
  ChatPlanStatus,
} from '../entities/chat-plan.enums';
import { ClientsRepository } from '../repositories/clients.repository';
import { chatPlanEntityToDto } from '../utils/chat-plan-mappers';
import { buildChatPlanResumeSessionSuffix } from '../utils/chat-plan-prompt.utils';

import { ChatPlanChatSyncService } from './chat-plan-chat-sync.service';

export type CreateChatPlanInput = {
  clientId: string;
  agentId: string;
  chatId: string;
  message: string;
  model?: string | null;
  contextInjection?: ChatPlanContextInjectionJson | null;
  createdByUserId?: string | null;
};

@Injectable()
export class ChatPlanService {
  constructor(
    @InjectRepository(ChatPlanEntity)
    private readonly planRepo: Repository<ChatPlanEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly chatPlanChatSync: ChatPlanChatSyncService,
  ) {}

  /** Map entity → DTO. */
  mapPlan(row: ChatPlanEntity): ChatPlanResponseDto {
    return chatPlanEntityToDto(row);
  }

  private async assertClientAccess(clientId: string, req?: RequestWithUser): Promise<void> {
    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, req);
  }

  async findActiveForChat(agentId: string, chatId: string): Promise<ChatPlanEntity | null> {
    return await this.planRepo.findOne({
      where: {
        agentId,
        chatId,
        status: In([...CHAT_PLAN_ACTIVE_STATUSES]),
      },
      order: { startedAt: 'DESC' },
    });
  }

  async create(input: CreateChatPlanInput, req?: RequestWithUser): Promise<ChatPlanResponseDto> {
    await this.assertClientAccess(input.clientId, req);

    const message = input.message?.trim() ?? '';

    if (!message) {
      throw new BadRequestException('Plan prompt is required');
    }

    if (!input.chatId) {
      throw new BadRequestException('chatId is required');
    }

    const active = await this.findActiveForChat(input.agentId, input.chatId);

    if (active) {
      throw new BadRequestException('An active plan already exists for this chat');
    }

    const userId = input.createdByUserId ?? getUserFromRequest(req || ({} as RequestWithUser)).userId ?? null;
    const now = new Date();
    // Insert with a temporary suffix, then set `-plan-{id}` after we know the UUID.
    const row = await this.planRepo.save(
      this.planRepo.create({
        clientId: input.clientId,
        agentId: input.agentId,
        chatId: input.chatId,
        status: ChatPlanStatus.PENDING,
        phase: ChatPlanPhase.EXPLORE,
        sourcePrompt: message,
        planMarkdown: null,
        summary: null,
        contextInjection: input.contextInjection ?? null,
        model: input.model?.trim() || null,
        resumeSessionSuffix: '-plan-pending',
        completionSignalSeen: false,
        createdByUserId: userId,
        startedAt: now,
        finishedAt: null,
      }),
    );

    row.resumeSessionSuffix = buildChatPlanResumeSessionSuffix(row.id);
    row.status = ChatPlanStatus.EXPLORING;
    const saved = await this.planRepo.save(row);

    this.chatPlanChatSync.emitLiveUpdateFromEntity(saved);

    return this.mapPlan(saved);
  }

  async get(clientId: string, agentId: string, planId: string, req?: RequestWithUser): Promise<ChatPlanResponseDto> {
    await this.assertClientAccess(clientId, req);
    const row = await this.planRepo.findOne({ where: { id: planId, clientId, agentId } });

    if (!row) {
      throw new NotFoundException('Plan not found');
    }

    return this.mapPlan(row);
  }

  async listByChat(
    clientId: string,
    agentId: string,
    chatId: string,
    req?: RequestWithUser,
  ): Promise<ChatPlanResponseDto[]> {
    await this.assertClientAccess(clientId, req);
    const rows = await this.planRepo.find({
      where: { clientId, agentId, chatId },
      order: { startedAt: 'DESC' },
    });

    return rows.map((r) => this.mapPlan(r));
  }

  async getEntityOrThrow(planId: string): Promise<ChatPlanEntity> {
    const row = await this.planRepo.findOne({ where: { id: planId } });

    if (!row) {
      throw new NotFoundException('Plan not found');
    }

    return row;
  }

  async cancel(
    clientId: string,
    agentId: string,
    planId: string,
    req?: RequestWithUser,
    actorUserId?: string | null,
  ): Promise<ChatPlanResponseDto> {
    if (req) {
      await this.assertClientAccess(clientId, req);
    }

    const info = getUserFromRequest(req || ({} as RequestWithUser));
    const userId = actorUserId ?? info.userId;

    // Gateway path passes req=undefined after socket auth; allow cancel without HTTP user context.
    if (req && !userId && !info.isApiKeyAuth) {
      throw new ForbiddenException('User context required to cancel');
    }

    const row = await this.planRepo.findOne({ where: { id: planId, clientId, agentId } });

    if (!row) {
      throw new NotFoundException('Plan not found');
    }

    if (
      row.status !== ChatPlanStatus.PENDING &&
      row.status !== ChatPlanStatus.EXPLORING &&
      row.status !== ChatPlanStatus.REFINING &&
      row.status !== ChatPlanStatus.EXECUTING
    ) {
      return this.mapPlan(row);
    }

    row.status = ChatPlanStatus.CANCELLED;
    row.finishedAt = new Date();
    row.failureCode = ChatPlanFailureCode.CANCELLED;
    row.failureMessage = 'Cancelled by user';
    const saved = await this.planRepo.save(row);

    this.chatPlanChatSync.emitLiveUpdateFromEntity(saved);

    return this.mapPlan(saved);
  }

  async saveAndEmit(row: ChatPlanEntity): Promise<ChatPlanEntity> {
    const saved = await this.planRepo.save(row);

    this.chatPlanChatSync.emitLiveUpdateFromEntity(saved);

    return saved;
  }

  /**
   * Conditionally patch a plan only when its current DB status is in `expectedStatuses`.
   * Returns false when the row was cancelled/executed/etc. (prevents stale in-memory saves).
   */
  async updateIfStatus(
    planId: string,
    expectedStatuses: readonly ChatPlanStatus[],
    patch: Partial<
      Pick<
        ChatPlanEntity,
        | 'status'
        | 'phase'
        | 'planMarkdown'
        | 'summary'
        | 'completionSignalSeen'
        | 'failureCode'
        | 'failureMessage'
        | 'finishedAt'
        | 'startedAt'
      >
    >,
  ): Promise<boolean> {
    if (expectedStatuses.length === 0) {
      return false;
    }

    const result = await this.planRepo
      .createQueryBuilder()
      .update(ChatPlanEntity)
      .set({
        ...patch,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :planId', { planId })
      .andWhere('status IN (:...statuses)', { statuses: [...expectedStatuses] })
      .execute();

    if ((result.affected ?? 0) < 1) {
      return false;
    }

    await this.chatPlanChatSync.emitLiveUpdateByPlanId(planId);

    return true;
  }
}
