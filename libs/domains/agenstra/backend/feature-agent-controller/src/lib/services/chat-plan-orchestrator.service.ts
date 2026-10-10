import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

import type { ChatPlanContextInjectionJson } from '../entities/chat-plan.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { ChatPlanFailureCode, ChatPlanPhase, ChatPlanStatus } from '../entities/chat-plan.enums';
import { buildExecutePrompt, buildExplorePrompt, buildRefinePrompt } from '../utils/chat-plan-prompt.utils';
import {
  resolvePlanMarkdownFromTurn,
  parsePlanTurnStatusFromAssistantText,
  type AgenstraPlanTurnStatusPayload,
} from '../utils/chat-plan-turn-status';

import { ChatPlanChatSyncService } from './chat-plan-chat-sync.service';
import { ChatPlanService } from './chat-plan.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

const UPSERT_THROTTLE_MS = 350;

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
  startRefine(planId: string, refineMessage: string, contextInjection?: ChatPlanContextInjectionJson): void {
    void this.runRefine(planId, refineMessage, contextInjection).catch((err) => {
      this.logger.warn(`startRefine failed for ${planId}: ${(err as Error).message}`);
    });
  }

  startExecute(planId: string, correlationId?: string): void {
    void this.runExecute(planId, correlationId).catch((err) => {
      this.logger.warn(`startExecute failed for ${planId}: ${(err as Error).message}`);
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
    await this.chatPlanService.updateIfStatus(
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

    let draft = '';

    try {
      const result = await this.remoteAgents.sendChatStreaming({
        clientId: plan.clientId,
        agentId: plan.agentId,
        message: buildExplorePrompt(plan.sourcePrompt),
        correlationId: `${plan.id}:explore`,
        continue: false,
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
      });

      if (await this.isCancelled(planId)) {
        return;
      }

      await this.applyTurnResult(planId, result.text, result.planTurnStatus);
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
  ): Promise<void> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    if (plan.status === ChatPlanStatus.REFINING) {
      this.logger.debug(`Ignoring concurrent refine for plan ${planId}`);

      return;
    }

    if (plan.status !== ChatPlanStatus.READY) {
      return;
    }

    const message = refineMessage?.trim() ?? '';

    if (!message) {
      return;
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

    const effectiveContextInjection = contextInjection ?? plan.contextInjection ?? undefined;

    let draft = '';

    try {
      const result = await this.remoteAgents.sendChatStreaming({
        clientId: plan.clientId,
        agentId: plan.agentId,
        message: buildRefinePrompt(message, plan.planMarkdown),
        correlationId: `${plan.id}:refine:${randomUUID()}`,
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
      });

      if (await this.isCancelled(planId)) {
        return;
      }

      await this.applyTurnResult(planId, result.text, result.planTurnStatus);
    } catch (error: unknown) {
      if (await this.isCancelled(planId)) {
        return;
      }

      await this.failPlan(planId, ChatPlanFailureCode.AGENT_PROVIDER_ERROR, 'Plan refine turn failed');
      this.logger.warn(`Refine turn error for ${planId}: ${(error as Error).message}`);
    }
  }

  private async runExecute(planId: string, correlationId?: string): Promise<void> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    if (
      plan.status === ChatPlanStatus.EXECUTING ||
      plan.status === ChatPlanStatus.EXECUTED ||
      plan.status === ChatPlanStatus.CANCELLED
    ) {
      this.logger.debug(`Ignoring execute for plan ${planId} in status ${plan.status}`);

      return;
    }

    if (plan.status !== ChatPlanStatus.READY) {
      return;
    }

    if (plan.phase !== ChatPlanPhase.READY) {
      this.logger.debug(`Ignoring execute for plan ${planId} in phase ${plan.phase}`);

      return;
    }

    const markdown = plan.planMarkdown?.trim();

    if (!markdown) {
      await this.failPlan(planId, ChatPlanFailureCode.INVALID_STATUS, 'Plan has no markdown to execute');

      return;
    }

    const started = await this.chatPlanService.updateIfStatus(planId, [ChatPlanStatus.READY], {
      status: ChatPlanStatus.EXECUTING,
    });

    if (!started) {
      return;
    }

    try {
      await this.remoteAgents.sendChatStreaming({
        clientId: plan.clientId,
        agentId: plan.agentId,
        message: buildExecutePrompt(markdown, plan.sourcePrompt),
        correlationId: correlationId ?? `${plan.id}:execute`,
        continue: false,
        chatId: plan.chatId,
        ephemeral: false,
        suppressUserMessage: true,
        model: plan.model ?? undefined,
        contextInjection: plan.contextInjection ?? undefined,
        statisticsInteractionKind: StatisticsInteractionKind.CHAT_PLAN_EXECUTE,
      });

      const completed = await this.chatPlanService.updateIfStatus(planId, [ChatPlanStatus.EXECUTING], {
        status: ChatPlanStatus.EXECUTED,
        phase: ChatPlanPhase.READY,
        finishedAt: new Date(),
      });

      if (completed) {
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

  private async applyTurnResult(
    planId: string,
    text: string,
    turnStatus: AgenstraPlanTurnStatusPayload | undefined,
  ): Promise<void> {
    const plan = await this.chatPlanService.getEntityOrThrow(planId);

    if (
      plan.status !== ChatPlanStatus.EXPLORING &&
      plan.status !== ChatPlanStatus.REFINING &&
      plan.status !== ChatPlanStatus.PENDING
    ) {
      return;
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

    if (effectiveStatus?.status === 'ready' || (markdown && effectiveStatus?.status !== 'exploring')) {
      await this.chatPlanService.updateIfStatus(planId, STREAMING_STATUSES, {
        ...(markdown ? { planMarkdown: markdown } : {}),
        ...(summary ? { summary } : {}),
        status: ChatPlanStatus.READY,
        phase: ChatPlanPhase.READY,
        completionSignalSeen: effectiveStatus?.status === 'ready',
        finishedAt: null,
      });
    } else if (markdown) {
      await this.chatPlanService.updateIfStatus(planId, STREAMING_STATUSES, {
        planMarkdown: markdown,
        ...(summary ? { summary } : {}),
        status: ChatPlanStatus.READY,
        phase: ChatPlanPhase.DRAFT,
        completionSignalSeen: false,
        finishedAt: null,
      });
    } else {
      await this.chatPlanService.updateIfStatus(planId, STREAMING_STATUSES, {
        status: ChatPlanStatus.FAILED,
        failureCode: ChatPlanFailureCode.AGENT_NO_PLAN_STATUS,
        failureMessage: 'Plan turn completed without usable plan content',
        finishedAt: new Date(),
      });
    }

    await this.emitThrottled(planId, true);
  }
}
