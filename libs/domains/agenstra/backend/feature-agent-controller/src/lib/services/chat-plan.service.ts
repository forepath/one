import {
  ClientUsersRepository,
  ensureClientAccess,
  getUserFromRequest,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type {
  ChatPlanActivityResponseDto,
  ChatPlanListResponseDto,
  ChatPlanResponseDto,
  UpdateChatPlanDto,
} from '../dto/chat-plan';
import { ChatPlanEntity, type ChatPlanContextInjectionJson } from '../entities/chat-plan.entity';
import {
  CHAT_PLAN_ACTIVE_STATUSES,
  CHAT_PLAN_EDITABLE_STATUSES,
  CHAT_PLAN_LIMITS,
  ChatPlanActionType,
  ChatPlanFailureCode,
  ChatPlanPhase,
  ChatPlanStatus,
} from '../entities/chat-plan.enums';
import { ClientsRepository } from '../repositories/clients.repository';
import {
  agentContentAttribution,
  isAgentContentWriter,
  principalUserId,
  type AgentContentWriter,
  type ContentPrincipal,
} from '../utils/agent-content-writer.utils';
import {
  buildChatPlanContextSection,
  chatPlanContextTitle,
  chatPlanEntityToDto,
  isChatPlanEditable,
} from '../utils/chat-plan-mappers';
import { buildChatPlanResumeSessionSuffix } from '../utils/chat-plan-prompt.utils';

import { CHAT_PLAN_AGENT_ACTOR, ChatPlanActivityService, chatPlanUserActor } from './chat-plan-activity.service';
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

/** Plans page filter: plans that can still be edited, plans that ran (read-only), or both. */
export type ChatPlanListState = 'editable' | 'readonly';

export interface ChatPlanListOptions {
  search?: string;
  state?: ChatPlanListState;
  limit?: number;
  offset?: number;
}

/** Linked plans per prompt (chat context selection). */
const CHAT_PLAN_CONTEXT_MAX_REFS = 20;
const PLAN_EXECUTED_READ_ONLY_MESSAGE = 'This plan has been executed and is read-only.';
const PLAN_DRAFTING_MESSAGE = 'The agent is working on this plan; wait until it is ready before editing it.';
const PLAN_CHANGED_MESSAGE = 'The plan changed since you opened it; reload it before saving.';

/** `%` / `_` / `\` in user input match literally in ILIKE. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class ChatPlanService {
  constructor(
    @InjectRepository(ChatPlanEntity)
    private readonly planRepo: Repository<ChatPlanEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly chatPlanChatSync: ChatPlanChatSyncService,
    private readonly chatPlanActivity: ChatPlanActivityService,
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
    row.longSha = ChatPlanEntity.deriveLongSha(row.id);
    row.status = ChatPlanStatus.EXPLORING;
    const saved = await this.planRepo.save(row);

    await this.chatPlanActivity.append(saved.id, ChatPlanActionType.CREATED, chatPlanUserActor(userId), {
      chatId: saved.chatId,
    });
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

  /**
   * Plans of one agent for the plans page, newest first. `search` matches title, original request and plan body
   * (case-insensitive); `state` narrows to editable or read-only (executed / executing / being drafted) plans.
   */
  async listForAgent(
    clientId: string,
    agentId: string,
    options: ChatPlanListOptions,
    req?: RequestWithUser,
  ): Promise<ChatPlanListResponseDto> {
    await this.assertClientAccess(clientId, req);

    const take = Math.min(
      Math.max(1, Math.floor(options.limit ?? CHAT_PLAN_LIMITS.listDefaultLimit)),
      CHAT_PLAN_LIMITS.listMaxLimit,
    );
    const skip = Math.max(0, Math.floor(options.offset ?? 0));
    const search = (options.search ?? '').trim().slice(0, CHAT_PLAN_LIMITS.searchMaxLength);
    const qb = this.planRepo
      .createQueryBuilder('p')
      .where('p.client_id = :clientId', { clientId })
      .andWhere('p.agent_id = :agentId', { agentId });

    if (search) {
      qb.andWhere(
        `(p.summary ILIKE :pattern ESCAPE '\\' OR p.source_prompt ILIKE :pattern ESCAPE '\\' OR p.plan_markdown ILIKE :pattern ESCAPE '\\')`,
        { pattern: `%${escapeLikePattern(search)}%` },
      );
    }

    if (options.state === 'editable') {
      qb.andWhere('p.execution_started_at IS NULL').andWhere('p.status IN (:...editable)', {
        editable: [...CHAT_PLAN_EDITABLE_STATUSES],
      });
    } else if (options.state === 'readonly') {
      qb.andWhere('(p.execution_started_at IS NOT NULL OR p.status NOT IN (:...editable))', {
        editable: [...CHAT_PLAN_EDITABLE_STATUSES],
      });
    }

    const [rows, total] = await qb
      .orderBy('p.started_at', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .take(take)
      .skip(skip)
      .getManyAndCount();

    return { items: rows.map((row) => this.mapPlan(row)), total };
  }

  /**
   * User edit of a plan that never entered execution (plans page). The write is conditional on the edited version
   * (`expectedUpdatedAt`) and on the plan still being editable, so it can never interleave with the agent drafting it
   * or with an execution starting: execution reads the plan only after its own conditional transition, which means it
   * always runs exactly the latest saved version — and once it started, edits are refused.
   */
  async update(
    clientId: string,
    agentId: string,
    planId: string,
    dto: UpdateChatPlanDto,
    req?: RequestWithUser,
  ): Promise<ChatPlanResponseDto> {
    await this.assertClientAccess(clientId, req);

    const row = await this.planRepo.findOne({ where: { id: planId, clientId, agentId } });

    if (!row) {
      throw new NotFoundException('Plan not found');
    }

    return this.mapPlan(await this.applyEdit(row, dto, req));
  }

  /**
   * Edit by the agent itself (`agenstra_content_plan_update`, decided by the manager): same rules as a user edit —
   * plans of the agent's own environment only, never once execution started, conditional on `revision`.
   */
  async updateForAgent(
    writer: AgentContentWriter,
    sha: string,
    input: { revision: string; title?: string; content?: string },
  ): Promise<ChatPlanEntity> {
    const row = await this.findForAgentBySha(writer.clientId, writer.agentId, sha);

    if (!row) {
      throw new NotFoundException('Plan not found in this environment');
    }

    return await this.applyEdit(
      row,
      { planMarkdown: input.content, summary: input.title, expectedUpdatedAt: input.revision },
      writer,
    );
  }

  /**
   * Conditional write shared by users and agents. The UPDATE only applies while the plan is still editable and still
   * the edited version, so it can never interleave with the agent drafting it or with an execution starting:
   * execution reads the plan only after its own conditional transition, i.e. it always runs exactly the latest saved
   * version — and once it started, edits are refused.
   */
  private async applyEdit(
    row: ChatPlanEntity,
    dto: UpdateChatPlanDto,
    principal?: ContentPrincipal,
  ): Promise<ChatPlanEntity> {
    this.assertEditable(row);

    const expected = new Date(dto.expectedUpdatedAt);

    if (Number.isNaN(expected.getTime()) || row.updatedAt.getTime() !== expected.getTime()) {
      throw new ConflictException(PLAN_CHANGED_MESSAGE);
    }

    const patch: Partial<Pick<ChatPlanEntity, 'planMarkdown' | 'summary'>> = {};

    if (dto.planMarkdown !== undefined) {
      if (!dto.planMarkdown.trim()) {
        throw new BadRequestException('planMarkdown must not be empty');
      }

      if (dto.planMarkdown.length > CHAT_PLAN_LIMITS.planMarkdownMaxLength) {
        throw new BadRequestException(
          `planMarkdown must be at most ${CHAT_PLAN_LIMITS.planMarkdownMaxLength} characters`,
        );
      }

      if (dto.planMarkdown !== (row.planMarkdown ?? '')) {
        patch.planMarkdown = dto.planMarkdown;
      }
    }

    if (dto.summary !== undefined) {
      const summary = dto.summary.trim() || null;

      if (summary && summary.length > CHAT_PLAN_LIMITS.summaryMaxLength) {
        throw new BadRequestException(`summary must be at most ${CHAT_PLAN_LIMITS.summaryMaxLength} characters`);
      }

      if (summary !== (row.summary ?? null)) {
        patch.summary = summary;
      }
    }

    const fields = Object.keys(patch);

    if (fields.length === 0) {
      return row;
    }

    const userId = principalUserId(principal);
    const result = await this.planRepo
      .createQueryBuilder()
      .update(ChatPlanEntity)
      .set({
        ...patch,
        lastEditedAt: () => 'CURRENT_TIMESTAMP',
        lastEditedByUserId: userId,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :planId', { planId: row.id })
      .andWhere('status IN (:...statuses)', { statuses: [...CHAT_PLAN_EDITABLE_STATUSES] })
      .andWhere('execution_started_at IS NULL')
      // `updated_at` keeps microseconds while JS dates carry milliseconds.
      .andWhere("date_trunc('milliseconds', updated_at) = :expected", { expected })
      .execute();

    if ((result.affected ?? 0) < 1) {
      const current = await this.getEntityOrThrow(row.id);

      this.assertEditable(current);

      throw new ConflictException(PLAN_CHANGED_MESSAGE);
    }

    await this.chatPlanActivity.append(
      row.id,
      ChatPlanActionType.CONTENT_UPDATED,
      isAgentContentWriter(principal) ? CHAT_PLAN_AGENT_ACTOR : chatPlanUserActor(userId),
      { fields, ...agentContentAttribution(principal) },
    );

    const saved = await this.getEntityOrThrow(row.id);

    this.chatPlanChatSync.emitLiveUpdateFromEntity(saved);

    return saved;
  }

  /**
   * Plan of one environment by context SHA. A short SHA only resolves when exactly one plan of the environment has
   * it: grants are bound to the element the user approved, an ambiguous prefix must never pick "some" plan.
   */
  async findForAgentBySha(clientId: string, agentId: string, sha: string): Promise<ChatPlanEntity | null> {
    const normalized = sha.trim().toLowerCase();

    if (!/^[0-9a-f]{4,40}$/.test(normalized)) {
      return null;
    }

    if (normalized.length === 40) {
      return await this.planRepo.findOne({ where: { clientId, agentId, longSha: normalized } });
    }

    const matches = await this.planRepo
      .createQueryBuilder('p')
      .where('p.client_id = :clientId', { clientId })
      .andWhere('p.agent_id = :agentId', { agentId })
      .andWhere('p.long_sha LIKE :prefix', { prefix: `${normalized}%` })
      .orderBy('p.started_at', 'DESC')
      .take(2)
      .getMany();

    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Linked plans as prompt context (chat composer / plan refine "Select context"): plans of the chat's environment
   * only, for users with workspace access. Unknown / other environments' SHAs are skipped silently.
   */
  async collectPromptContextsByShas(
    clientId: string,
    agentId: string,
    shas: readonly string[],
    req?: RequestWithUser,
  ): Promise<{ promptSections: string[]; refs: Array<{ sha: string; title: string }> }> {
    await this.assertClientAccess(clientId, req);

    const promptSections: string[] = [];
    const refs: Array<{ sha: string; title: string }> = [];
    const seen = new Set<string>();

    for (const sha of shas.slice(0, CHAT_PLAN_CONTEXT_MAX_REFS)) {
      const plan = await this.findForAgentBySha(clientId, agentId, sha);

      if (!plan?.longSha || seen.has(plan.id)) {
        continue;
      }

      seen.add(plan.id);
      promptSections.push(buildChatPlanContextSection(plan));
      refs.push({ sha: plan.longSha, title: chatPlanContextTitle(plan) });
    }

    return { promptSections, refs };
  }

  async listActivity(
    clientId: string,
    agentId: string,
    planId: string,
    options: { limit?: number; offset?: number },
    req?: RequestWithUser,
  ): Promise<ChatPlanActivityResponseDto[]> {
    await this.assertClientAccess(clientId, req);

    const row = await this.planRepo.findOne({ where: { id: planId, clientId, agentId }, select: { id: true } });

    if (!row) {
      throw new NotFoundException('Plan not found');
    }

    return await this.chatPlanActivity.list(planId, options.limit, options.offset);
  }

  private assertEditable(row: ChatPlanEntity): void {
    if (isChatPlanEditable(row)) {
      return;
    }

    throw new ConflictException(row.executionStartedAt ? PLAN_EXECUTED_READ_ONLY_MESSAGE : PLAN_DRAFTING_MESSAGE);
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

    await this.chatPlanActivity.append(saved.id, ChatPlanActionType.CANCELLED, chatPlanUserActor(userId), {});

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
        | 'contextInjection'
        | 'executionStartedAt'
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
