import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import type { ChatPlanContextInjectionJson } from '../entities/chat-plan.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { ChatPlanActionType, ChatPlanFailureCode, ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';
import {
  buildExecutePrompt,
  buildExplorePrompt,
  buildPlanRepairPrompt,
  buildRefinePrompt,
} from '../utils/chat-plan-prompt.utils';
import {
  resolvePlanMarkdownFromTurn,
  parsePlanTurnStatusFromAssistantText,
  type AgenstraPlanTurnStatusPayload,
} from '../utils/chat-plan-turn-status';

import {
  CHAT_PLAN_AGENT_ACTOR,
  CHAT_PLAN_SYSTEM_ACTOR,
  ChatPlanActivityService,
  chatPlanUserActor,
} from './chat-plan-activity.service';
import { ChatPlanChatSyncService } from './chat-plan-chat-sync.service';
import { ChatPlanService } from './chat-plan.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

const UPSERT_THROTTLE_MS = 350;
const PLAN_TURN_REPAIR_ATTEMPTS = 2;
/** Refine instructions kept in the activity log. */
const ACTIVITY_INSTRUCTIONS_MAX_LENGTH = 2000;

const STREAMING_STATUSES: readonly ChatPlanStatus[] = [
  ChatPlanStatus.PENDING,
  ChatPlanStatus.EXPLORING,
  ChatPlanStatus.REFINING,
];

@Injectable()
export class ChatPlanOrchestratorService {
  private readonly logger = new Logger(ChatPlanOrchestratorService.name);
  private readonly lastUpsertAtByPlanId = new Map<string, number>();

  constructor(
    private readonly chatPlanService: ChatPlanService,
    private readonly chatPlanChatSync: ChatPlanChatSyncService,
    private readonly remoteAgents: RemoteAgentsSessionService,
    private readonly chatPlanActivity: ChatPlanActivityService,
  ) {}

  /**
   * Kick off explore on the hidden `-plan-{id}` session (fire-and-forget from gateway).
   */
  startExplore(planId: string): void {
    void this.runExplore(planId).catch((err) => {
      this.logger.warn(`startExplore failed for ${planId}: ${(err as Error).message}`);
    });
  }

  /**
   * @param contextInjection Optional replacement snapshot; when set it is persisted on the plan and reused by
   * subsequent refine/execute turns.
   */
  startRefine(
    planId: string,
    refineMessage: string,
    contextInjection?: ChatPlanContextInjectionJson,
    actorUserId?: string | null,
  ): void {
    void this.runRefine(planId, refineMessage, contextInjection, actorUserId).catch((err) => {
      this.logger.warn(`startRefine failed for ${planId}: ${(err as Error).message}`);
    });
  }

  startExecute(planId: string, correlationId?: string, actorUserId?: string | null): void {
    void this.runExecute(planId, correlationId, actorUserId).catch((err) => {
      this.logger.warn(`startExecute failed for ${planId}: ${(err as Error).message}`);
    });
  }

  startRetry(planId: string, correlationId?: string, actorUserId?: string | null): void {
    void this.runRetry(planId, correlationId, actorUserId).catch((err) => {
      this.logger.warn(`startRetry failed for ${planId}: ${(err as Error).message}`);
    });
  }

  private async isCancelled(planId: string): Promise<boolean> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    return plan.status === ChatPlanStatus.CANCELLED;
  }

  private async emitThrottled(planId: string, force = false): Promise<void> {
    const now = Date.now();
    const last = this.lastUpsertAtByPlanId.get(planId) ?? 0;

    if (!force && now - last < UPSERT_THROTTLE_MS) {
      return;
    }

    this.lastUpsertAtByPlanId.set(planId, now);
    await this.chatPlanChatSync.emitLiveUpdateByPlanId(planId);
  }

  private async failPlan(planId: string, code: ChatPlanFailureCode, message: string): Promise<void> {
    const failed = await this.chatPlanService.updateIfStatus(
      planId,
      [
        ChatPlanStatus.PENDING,
        ChatPlanStatus.EXPLORING,
        ChatPlanStatus.REFINING,
        ChatPlanStatus.READY,
        ChatPlanStatus.EXECUTING,
      ],
      {
        status: ChatPlanStatus.FAILED,
        finishedAt: new Date(),
        failureCode: code,
        failureMessage: message,
      },
    );

    if (failed) {
      await this.chatPlanActivity.append(planId, ChatPlanActionType.FAILED, CHAT_PLAN_SYSTEM_ACTOR, { code, message });
    }
  }

  private async writeStreamingMarkdown(planId: string, draft: string, phase: ChatPlanPhase): Promise<void> {
    const updated = await this.chatPlanService.updateIfStatus(planId, STREAMING_STATUSES, {
      planMarkdown: draft,
      phase,
    });

    if (updated) {
      await this.emitThrottled(planId);
    }
  }

  private async runExplore(planId: string): Promise<void> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    if (plan.status !== ChatPlanStatus.EXPLORING && plan.status !== ChatPlanStatus.PENDING) {
      return;
    }

    const started = await this.chatPlanService.updateIfStatus(
      planId,
      [ChatPlanStatus.PENDING, ChatPlanStatus.EXPLORING],
      {
        status: ChatPlanStatus.EXPLORING,
        phase: ChatPlanPhase.EXPLORE,
      },
    );

    if (!started) {
      return;
    }

    let lastDraft = '';

    try {
      for (let attempt = 0; attempt <= PLAN_TURN_REPAIR_ATTEMPTS; attempt++) {
        let draft = '';
        const result = await this.remoteAgents.sendChatStreaming({
          clientId: plan.clientId,
          agentId: plan.agentId,
          message: attempt === 0 ? buildExplorePrompt(plan.sourcePrompt) : buildPlanRepairPrompt(lastDraft),
          correlationId: attempt === 0 ? `${plan.id}:explore` : `${plan.id}:explore:repair:${attempt}`,
          continue: attempt > 0,
          resumeSessionSuffix: plan.resumeSessionSuffix,
          ephemeral: true,
          model: plan.model ?? undefined,
          contextInjection: plan.contextInjection ?? undefined,
          statisticsInteractionKind: StatisticsInteractionKind.CHAT_PLAN_TURN,
          onDeltaText: async (delta) => {
            draft += delta;
            const liveMarkdown = resolvePlanMarkdownFromTurn(draft, undefined);

            if (liveMarkdown) {
              await this.writeStreamingMarkdown(planId, liveMarkdown, ChatPlanPhase.DRAFT);
            }
          },
          onEvent: async (event) => {
            this.chatPlanChatSync.addLiveEvent(planId, event);
            await this.emitThrottled(planId);
          },
        });

        if (await this.isCancelled(planId)) {
          return;
        }

        lastDraft = draft || result.text;

        if (await this.applyTurnResult(planId, result.text, result.planTurnStatus)) {
          return;
        }

        this.logger.debug(`Plan ${planId} explore turn lacked usable content; repair attempt ${attempt + 1}`);
      }

      await this.failPlan(
        planId,
        ChatPlanFailureCode.AGENT_NO_PLAN_STATUS,
        'Plan turn completed without usable plan content',
      );
    } catch (error: unknown) {
      if (await this.isCancelled(planId)) {
        return;
      }

      await this.failPlan(planId, ChatPlanFailureCode.AGENT_PROVIDER_ERROR, 'Plan explore turn failed');
      this.logger.warn(`Explore turn error for ${planId}: ${(error as Error).message}`);
    }
  }

  private async runRefine(
    planId: string,
    refineMessage: string,
    contextInjection?: ChatPlanContextInjectionJson,
    actorUserId?: string | null,
  ): Promise<void> {
    const before = await this.chatPlanService.getEntityOrThrow(planId);

    if (before.status === ChatPlanStatus.REFINING) {
      this.logger.debug(`Ignoring concurrent refine for plan ${planId}`);

      return;
    }

    if (before.status !== ChatPlanStatus.READY) {
      return;
    }

    const message = refineMessage?.trim() ?? '';

    if (!message) {
      return;
    }

    // Initiative context of a story plan is platform-resolved (never accepted from a client): a refine from the chat
    // replaces the user's context selection but keeps it.
    if (contextInjection && before.contextInjection?.initiativeContexts?.length) {
      contextInjection = {
        ...contextInjection,
        initiativeContexts: before.contextInjection.initiativeContexts,
        initiativeContextRefs: before.contextInjection.initiativeContextRefs,
      };
    }

    const started = await this.chatPlanService.updateIfStatus(planId, [ChatPlanStatus.READY], {
      status: ChatPlanStatus.REFINING,
      phase: ChatPlanPhase.REFINE,
      completionSignalSeen: false,
      finishedAt: null,
      ...(contextInjection ? { contextInjection } : {}),
    });

    if (!started) {
      return;
    }

    // Read after the conditional transition: a user edit saved right before it is part of the draft being refined
    // (edits are refused from here on until the plan is ready again).
    const plan = await this.chatPlanService.getEntityOrThrow(planId);
    const effectiveContextInjection = contextInjection ?? plan.contextInjection ?? undefined;

    await this.chatPlanActivity.append(planId, ChatPlanActionType.REFINE_REQUESTED, chatPlanUserActor(actorUserId), {
      instructions: message.slice(0, ACTIVITY_INSTRUCTIONS_MAX_LENGTH),
    });

    let lastDraft = '';

    try {
      for (let attempt = 0; attempt <= PLAN_TURN_REPAIR_ATTEMPTS; attempt++) {
        let draft = '';
        const result = await this.remoteAgents.sendChatStreaming({
          clientId: plan.clientId,
          agentId: plan.agentId,
          message:
            attempt === 0
              ? buildRefinePrompt(message, plan.planMarkdown, { editedByUser: !!plan.lastEditedAt })
              : buildPlanRepairPrompt(lastDraft || plan.planMarkdown),
          correlationId: `${plan.id}:refine:${attempt === 0 ? randomUUID() : `repair:${attempt}:${randomUUID()}`}`,
          continue: true,
          resumeSessionSuffix: plan.resumeSessionSuffix,
          ephemeral: true,
          model: plan.model ?? undefined,
          contextInjection: effectiveContextInjection,
          statisticsInteractionKind: StatisticsInteractionKind.CHAT_PLAN_TURN,
          onDeltaText: async (delta) => {
            draft += delta;
            const liveMarkdown = resolvePlanMarkdownFromTurn(draft, undefined);

            if (liveMarkdown) {
              await this.writeStreamingMarkdown(planId, liveMarkdown, ChatPlanPhase.REFINE);
            }
          },
          onEvent: async (event) => {
            this.chatPlanChatSync.addLiveEvent(planId, event);
            await this.emitThrottled(planId);
          },
        });

        if (await this.isCancelled(planId)) {
          return;
        }

        lastDraft = draft || result.text;

        if (await this.applyTurnResult(planId, result.text, result.planTurnStatus)) {
          return;
        }

        this.logger.debug(`Plan ${planId} refine turn lacked usable content; repair attempt ${attempt + 1}`);
      }

      await this.failPlan(
        planId,
        ChatPlanFailureCode.AGENT_NO_PLAN_STATUS,
        'Plan turn completed without usable plan content',
      );
    } catch (error: unknown) {
      if (await this.isCancelled(planId)) {
        return;
      }

      await this.failPlan(planId, ChatPlanFailureCode.AGENT_PROVIDER_ERROR, 'Plan refine turn failed');
      this.logger.warn(`Refine turn error for ${planId}: ${(error as Error).message}`);
    }
  }

  private async runExecute(planId: string, correlationId?: string, actorUserId?: string | null): Promise<void> {
    const before = await this.chatPlanService.getEntityOrThrow(planId);

    if (before.status === ChatPlanStatus.EXECUTING || before.status === ChatPlanStatus.EXECUTED) {
      this.logger.debug(`Ignoring execute for plan ${planId} in status ${before.status}`);

      return;
    }

    if (
      before.status !== ChatPlanStatus.READY &&
      before.status !== ChatPlanStatus.CANCELLED &&
      before.status !== ChatPlanStatus.FAILED
    ) {
      return;
    }

    if (before.phase !== ChatPlanPhase.READY) {
      this.logger.debug(`Ignoring execute for plan ${planId} in phase ${before.phase}`);

      return;
    }

    if (!before.planMarkdown?.trim()) {
      await this.failPlan(planId, ChatPlanFailureCode.INVALID_STATUS, 'Plan has no markdown to execute');

      return;
    }

    const started = await this.chatPlanService.updateIfStatus(
      planId,
      [ChatPlanStatus.READY, ChatPlanStatus.CANCELLED, ChatPlanStatus.FAILED],
      {
        status: ChatPlanStatus.EXECUTING,
        phase: ChatPlanPhase.READY,
        failureCode: null,
        failureMessage: null,
        finishedAt: null,
        // First execution locks the plan for good (a retry of a failed execution keeps the original time).
        executionStartedAt: before.executionStartedAt ?? new Date(),
      },
    );

    if (!started) {
      return;
    }

    // Read the plan only after the conditional transition: user edits are refused from that point on, so this is
    // exactly the latest saved version — never a version loaded before a concurrent edit.
    const plan = await this.chatPlanService.getEntityOrThrow(planId);
    const markdown = plan.planMarkdown?.trim();

    if (!markdown) {
      await this.failPlan(planId, ChatPlanFailureCode.INVALID_STATUS, 'Plan has no markdown to execute');

      return;
    }

    const editedByUser = !!plan.lastEditedAt;

    await this.chatPlanActivity.append(planId, ChatPlanActionType.EXECUTION_STARTED, chatPlanUserActor(actorUserId), {
      editedByUser,
      planMarkdownLength: markdown.length,
    });

    try {
      await this.remoteAgents.sendChatStreaming({
        clientId: plan.clientId,
        agentId: plan.agentId,
        message: buildExecutePrompt(markdown, plan.sourcePrompt, { editedByUser }),
        correlationId: correlationId ?? `${plan.id}:execute`,
        continue: true,
        // Execution runs in the plan's visible chat with the chat's normal (interactive) permissions: the hidden
        // `-plan-{id}` session is explore-only and cannot change the workspace. The execute prompt itself is not
        // shown as a user message; the agent's work appears in the chat and on the plan card.
        chatId: plan.chatId,
        ephemeral: false,
        suppressUserMessage: true,
        model: plan.model ?? undefined,
        contextInjection: plan.contextInjection ?? undefined,
        statisticsInteractionKind: StatisticsInteractionKind.CHAT_PLAN_EXECUTE,
        onEvent: async (event) => {
          this.chatPlanChatSync.addLiveEvent(planId, event);
          await this.emitThrottled(planId);
        },
      });

      const completed = await this.chatPlanService.updateIfStatus(planId, [ChatPlanStatus.EXECUTING], {
        status: ChatPlanStatus.EXECUTED,
        phase: ChatPlanPhase.READY,
        finishedAt: new Date(),
      });

      if (completed) {
        await this.chatPlanActivity.append(planId, ChatPlanActionType.EXECUTED, CHAT_PLAN_AGENT_ACTOR, {});
        await this.emitThrottled(planId, true);
      }
    } catch (error: unknown) {
      if (await this.isCancelled(planId)) {
        return;
      }

      await this.failPlan(planId, ChatPlanFailureCode.AGENT_PROVIDER_ERROR, 'Plan execute turn failed');
      this.logger.warn(`Execute turn error for ${planId}: ${(error as Error).message}`);
    }
  }

  private async runRetry(planId: string, correlationId?: string, actorUserId?: string | null): Promise<void> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    if (plan.status !== ChatPlanStatus.FAILED) {
      return;
    }

    this.chatPlanChatSync.clearLiveEvents(planId);
    await this.chatPlanActivity.append(planId, ChatPlanActionType.RETRY_REQUESTED, chatPlanUserActor(actorUserId), {});

    if (plan.phase === ChatPlanPhase.READY && plan.planMarkdown?.trim()) {
      await this.runExecute(planId, correlationId, actorUserId);

      return;
    }

    const restarted = await this.chatPlanService.updateIfStatus(planId, [ChatPlanStatus.FAILED], {
      status: ChatPlanStatus.EXPLORING,
      phase: ChatPlanPhase.EXPLORE,
      planMarkdown: null,
      summary: null,
      completionSignalSeen: false,
      failureCode: null,
      failureMessage: null,
      startedAt: new Date(),
      finishedAt: null,
    });

    if (!restarted) {
      return;
    }

    await this.runExplore(planId);
  }

  private async applyTurnResult(
    planId: string,
    text: string,
    turnStatus: AgenstraPlanTurnStatusPayload | undefined,
  ): Promise<boolean> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    if (
      plan.status !== ChatPlanStatus.EXPLORING &&
      plan.status !== ChatPlanStatus.REFINING &&
      plan.status !== ChatPlanStatus.PENDING
    ) {
      return true;
    }

    const parsedFromText = parsePlanTurnStatusFromAssistantText(text);
    const effectiveStatus: AgenstraPlanTurnStatusPayload | undefined = turnStatus?.planMarkdown
      ? turnStatus
      : {
          status: turnStatus?.status ?? parsedFromText?.status ?? 'exploring',
          planMarkdown: turnStatus?.planMarkdown ?? parsedFromText?.planMarkdown,
          summary: turnStatus?.summary ?? parsedFromText?.summary,
        };
    const markdown = resolvePlanMarkdownFromTurn(text, effectiveStatus);
    const summary =
      effectiveStatus?.summary && effectiveStatus.summary.trim()
        ? effectiveStatus.summary.trim().slice(0, 512)
        : undefined;

    let updated: boolean;
    let phase: ChatPlanPhase;

    if (effectiveStatus?.status === 'ready' || (markdown && effectiveStatus?.status !== 'exploring')) {
      phase = ChatPlanPhase.READY;
      updated = await this.chatPlanService.updateIfStatus(planId, STREAMING_STATUSES, {
        ...(markdown ? { planMarkdown: markdown } : {}),
        ...(summary ? { summary } : {}),
        status: ChatPlanStatus.READY,
        phase: ChatPlanPhase.READY,
        completionSignalSeen: effectiveStatus?.status === 'ready',
        finishedAt: null,
      });
    } else if (markdown) {
      phase = ChatPlanPhase.DRAFT;
      updated = await this.chatPlanService.updateIfStatus(planId, STREAMING_STATUSES, {
        planMarkdown: markdown,
        ...(summary ? { summary } : {}),
        status: ChatPlanStatus.READY,
        phase: ChatPlanPhase.DRAFT,
        completionSignalSeen: false,
        finishedAt: null,
      });
    } else {
      return false;
    }

    if (updated) {
      await this.chatPlanActivity.append(planId, ChatPlanActionType.DRAFT_UPDATED, CHAT_PLAN_AGENT_ACTOR, {
        phase,
        ready: phase === ChatPlanPhase.READY,
      });
    }

    await this.emitThrottled(planId, true);

    return true;
  }
}
