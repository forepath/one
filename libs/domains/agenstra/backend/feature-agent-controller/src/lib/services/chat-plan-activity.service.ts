import { UsersRepository } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { ChatPlanActivityResponseDto } from '../dto/chat-plan';
import { ChatPlanActivityEntity } from '../entities/chat-plan-activity.entity';
import { CHAT_PLAN_LIMITS, ChatPlanActionType, ChatPlanActorType } from '../entities/chat-plan.enums';

/** Who caused an activity row: a workspace user (`userId`), the agent, or the platform. */
export interface ChatPlanActivityActor {
  type: ChatPlanActorType;
  userId?: string | null;
}

export const CHAT_PLAN_AGENT_ACTOR: ChatPlanActivityActor = { type: ChatPlanActorType.AI };
export const CHAT_PLAN_SYSTEM_ACTOR: ChatPlanActivityActor = { type: ChatPlanActorType.SYSTEM };

/** A user id makes the actor human; without one (socket without user context, API key) it is the platform. */
export function chatPlanUserActor(userId: string | null | undefined): ChatPlanActivityActor {
  return userId ? { type: ChatPlanActorType.HUMAN, userId } : CHAT_PLAN_SYSTEM_ACTOR;
}

/**
 * Activity log of chat plans (plans page). Appending never fails the plan operation that caused it: the plan row is
 * the source of truth, the log only explains it.
 */
@Injectable()
export class ChatPlanActivityService {
  private readonly logger = new Logger(ChatPlanActivityService.name);

  constructor(
    @InjectRepository(ChatPlanActivityEntity)
    private readonly activityRepo: Repository<ChatPlanActivityEntity>,
    private readonly usersRepository: UsersRepository,
  ) {}

  async append(
    planId: string,
    actionType: ChatPlanActionType,
    actor: ChatPlanActivityActor,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.activityRepo.save(
        this.activityRepo.create({
          planId,
          actionType,
          actorType: actor.type,
          actorUserId: actor.userId ?? null,
          payload,
        }),
      );
    } catch (error: unknown) {
      this.logger.warn(`Could not record ${actionType} for plan ${planId}: ${(error as Error).message}`);
    }
  }

  /** Newest first (`id` breaks ties so offset pages stay stable). */
  async list(planId: string, limit?: number, offset?: number): Promise<ChatPlanActivityResponseDto[]> {
    const take = Math.min(
      Math.max(1, Math.floor(limit ?? CHAT_PLAN_LIMITS.activityDefaultLimit)),
      CHAT_PLAN_LIMITS.activityMaxLimit,
    );
    const rows = await this.activityRepo.find({
      where: { planId },
      order: { occurredAt: 'DESC', id: 'DESC' },
      take,
      skip: Math.max(0, Math.floor(offset ?? 0)),
    });
    const emails = await this.resolveEmails(rows);

    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      occurredAt: row.occurredAt,
      actorType: row.actorType,
      actorUserId: row.actorUserId ?? null,
      actorEmail: row.actorUserId ? (emails.get(row.actorUserId) ?? null) : null,
      actionType: row.actionType,
      payload: row.payload ?? {},
    }));
  }

  private async resolveEmails(rows: ChatPlanActivityEntity[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => !!id))];
    const emails = new Map<string, string>();

    for (const id of ids) {
      const user = await this.usersRepository.findById(id);

      if (user?.email) {
        emails.set(id, user.email);
      }
    }

    return emails;
  }
}
