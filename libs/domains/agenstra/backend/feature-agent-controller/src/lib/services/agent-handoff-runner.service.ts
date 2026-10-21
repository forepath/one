import type { AgentHandoffResponseStatus } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import {
  AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH,
  AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS,
  AGENT_HANDOFF_REQUEUE_AFTER_MS,
  AGENT_HANDOFF_RESPONSE_REPAIR_ATTEMPTS,
  AGENT_HANDOFF_STALE_GRACE_MS,
  getAgentHandoffTurnTimeoutMs,
} from '../constants/agent-handoffs.constants';
import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import {
  buildAgentHandoffDeliveryMessage,
  buildAgentHandoffFallbackResponse,
  buildAgentHandoffRepairPrompt,
  buildAgentHandoffTargetMessage,
} from '../utils/agent-handoff-prompt.utils';
import type { AgentHandoffJob } from '../utils/agent-handoff-queue.utils';

import { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

/**
 * Executes handoffs from the controller queue:
 * - unit: runs the target turn in its visible handoff chat (repair turns until it answered with
 *   `agenstra_handoff_respond`, like chat plan repair turns) and delivers the outcome into the source chat
 * - coordinator: fails stalled runs and re-enqueues lost units / undelivered responses
 *
 * Every terminal state (answered, platform fallback, error, timeout, interruption) ends in a response delivered
 * into the chat the handoff was made in — never into another one. When that chat is gone the handoff is marked
 * undeliverable (reported by `agenstra_handoff_get`).
 */
@Injectable()
export class AgentHandoffRunnerService {
  private readonly logger = new Logger(AgentHandoffRunnerService.name);

  constructor(
    @InjectRepository(AgentHandoffEntity)
    private readonly handoffRepo: Repository<AgentHandoffEntity>,
    private readonly remoteChat: RemoteAgentsSessionService,
    private readonly chatsProxy: ClientAgentChatsProxyService,
  ) {}

  /** Continue a handoff from its stored state. Re-delivered jobs never prompt the target twice. */
  async executeHandoff(job: AgentHandoffJob): Promise<void> {
    let handoff = await this.handoffRepo.findOne({ where: { id: job.handoffId } });

    if (!handoff) {
      return;
    }

    if (handoff.status === 'pending') {
      const claimed = await this.handoffRepo.update(
        { id: handoff.id, status: 'pending' },
        { status: 'running', startedAt: new Date() },
      );

      if (!claimed.affected) {
        return;
      }

      await this.runTarget(handoff);
      handoff = await this.handoffRepo.findOne({ where: { id: handoff.id } });
    }

    if (
      handoff &&
      (handoff.status === 'completed' || handoff.status === 'failed') &&
      !handoff.deliveredAt &&
      !handoff.deliveryFailureMessage
    ) {
      await this.deliver(handoff, handoff.status);
    }
  }

  /**
   * Coordinator tick: units that died mid-run (worker restart) are failed and delivered; pending units and
   * undelivered responses whose job got lost are enqueued again.
   */
  async sweep(enqueue: (job: AgentHandoffJob) => Promise<void>, now: Date = new Date()): Promise<number> {
    const maxRunMs =
      getAgentHandoffTurnTimeoutMs() * (AGENT_HANDOFF_RESPONSE_REPAIR_ATTEMPTS + 1) + AGENT_HANDOFF_STALE_GRACE_MS;
    const requeueCutoff = new Date(now.getTime() - AGENT_HANDOFF_REQUEUE_AFTER_MS);
    const stale = await this.handoffRepo.find({
      where: { status: 'running', startedAt: LessThan(new Date(now.getTime() - maxRunMs)) },
    });

    for (const handoff of stale) {
      await this.finish(handoff.id, 'failed', {
        failureMessage: 'The handoff did not finish (timed out or interrupted).',
      });
    }

    const due = await this.handoffRepo.find({
      where: [
        { status: 'pending', createdAt: LessThan(requeueCutoff) },
        {
          status: In(['completed', 'failed']),
          deliveredAt: IsNull(),
          deliveryFailureMessage: IsNull(),
          deliveryAttempts: LessThan(AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS),
          updatedAt: LessThan(requeueCutoff),
        },
      ],
    });
    const ids = new Set([...stale, ...due].map((handoff) => handoff.id));

    for (const handoffId of ids) {
      await enqueue({ handoffId });
    }

    return ids.size;
  }

  private async runTarget(handoff: AgentHandoffEntity): Promise<void> {
    if (!(await this.chatExists(handoff.clientId, handoff.targetAgentId, handoff.targetChatId))) {
      await this.finish(handoff.id, 'failed', {
        failureMessage: `The target agent "${handoff.targetAgentName}" or its handoff chat no longer exists.`,
      });

      return;
    }

    let lastAnswer: string | undefined;

    for (let attempt = 0; attempt <= AGENT_HANDOFF_RESPONSE_REPAIR_ATTEMPTS; attempt++) {
      try {
        const result = await this.remoteChat.sendChatStreaming({
          clientId: handoff.clientId,
          agentId: handoff.targetAgentId,
          chatId: handoff.targetChatId,
          ephemeral: false,
          // Repair turns stay out of the visible history; the agent's answer is shown like plan execute.
          suppressUserMessage: attempt > 0,
          continue: true,
          message: attempt === 0 ? buildAgentHandoffTargetMessage(handoff) : buildAgentHandoffRepairPrompt(handoff),
          correlationId: `agent-handoff:${handoff.id}:${attempt}`,
          ...(handoff.model ? { model: handoff.model } : {}),
          statisticsInteractionKind: StatisticsInteractionKind.AGENT_HANDOFF,
          chatTimeoutMs: getAgentHandoffTurnTimeoutMs(),
          contextInjection: {
            includeWorkspace: true,
            environmentIds: [handoff.targetAgentId],
            autoEnrichmentEnabled: false,
          },
        });

        if (result.text.trim()) {
          lastAnswer = result.text;
        }
      } catch (error) {
        if (await this.isAnswered(handoff.id)) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);

        const targetGone = !(await this.chatExists(handoff.clientId, handoff.targetAgentId, handoff.targetChatId).catch(
          () => true,
        ));

        this.logger.warn(`Handoff ${handoff.id}: target turn failed: ${message}`);
        await this.finish(handoff.id, 'failed', {
          response: buildAgentHandoffFallbackResponse(lastAnswer),
          failureMessage: targetGone
            ? `The target agent "${handoff.targetAgentName}" or its handoff chat no longer exists.`
            : `The agent could not work on the task: ${message}`,
        });

        return;
      }

      if (await this.isAnswered(handoff.id)) {
        return;
      }

      if (attempt < AGENT_HANDOFF_RESPONSE_REPAIR_ATTEMPTS) {
        this.logger.debug(`Handoff ${handoff.id}: no response yet, repair attempt ${attempt + 1}`);
      }
    }

    const fallback = buildAgentHandoffFallbackResponse(lastAnswer);

    await this.finish(
      handoff.id,
      fallback ? 'completed' : 'failed',
      fallback ? { response: fallback } : { failureMessage: 'The agent finished without a response.' },
    );
  }

  /**
   * Post the outcome into the chat the handoff was made in (only there). Delivered as soon as the manager accepted
   * the message, so a long source turn is never sent twice.
   */
  private async deliver(handoff: AgentHandoffEntity, status: AgentHandoffResponseStatus): Promise<void> {
    const correlationId = `agent-handoff:${handoff.id}:response`;
    let accepted = false;
    const markDelivered = async (): Promise<void> => {
      if (!accepted) {
        accepted = true;
        await this.handoffRepo.update({ id: handoff.id }, { deliveredAt: new Date() });
      }
    };

    try {
      if (!(await this.chatExists(handoff.clientId, handoff.sourceAgentId, handoff.sourceChatId))) {
        await this.markUndeliverable(handoff.id, 'The requesting chat no longer exists.');

        return;
      }

      await this.remoteChat.sendChatStreaming({
        clientId: handoff.clientId,
        agentId: handoff.sourceAgentId,
        chatId: handoff.sourceChatId,
        ephemeral: false,
        continue: true,
        // The requesting agent continues with the model its chat was using.
        ...(handoff.sourceModel ? { model: handoff.sourceModel } : {}),
        message: buildAgentHandoffDeliveryMessage(handoff, status),
        correlationId,
        statisticsInteractionKind: StatisticsInteractionKind.AGENT_HANDOFF,
        chatTimeoutMs: getAgentHandoffTurnTimeoutMs(),
        contextInjection: {
          includeWorkspace: true,
          environmentIds: [handoff.sourceAgentId],
          autoEnrichmentEnabled: false,
        },
        onEvent: async (event) => {
          if (isUserMessageEventOf(event, correlationId)) {
            await markDelivered();
          }
        },
      });
      await markDelivered();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (accepted) {
        this.logger.debug(`Handoff ${handoff.id}: response delivered, source turn ended with: ${message}`);

        return;
      }

      await this.handoffRepo.increment({ id: handoff.id }, 'deliveryAttempts', 1);
      this.logger.warn(`Handoff ${handoff.id}: response delivery failed: ${message}`);

      if (handoff.deliveryAttempts + 1 >= AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS) {
        await this.markUndeliverable(
          handoff.id,
          `The response could not be delivered after ${AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS} attempts: ${message}`,
        );

        return;
      }

      throw error;
    }
  }

  private async markUndeliverable(handoffId: string, message: string): Promise<void> {
    this.logger.warn(`Handoff ${handoffId}: response undeliverable: ${message}`);
    await this.handoffRepo.update(
      { id: handoffId },
      { deliveryFailureMessage: message.slice(0, AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH) },
    );
  }

  private async chatExists(clientId: string, agentId: string, chatId: string): Promise<boolean> {
    try {
      await this.chatsProxy.get(clientId, agentId, chatId);

      return true;
    } catch (error) {
      if (error instanceof NotFoundException) {
        return false;
      }

      throw error;
    }
  }

  private async isAnswered(handoffId: string): Promise<boolean> {
    const handoff = await this.handoffRepo.findOne({ where: { id: handoffId } });

    return !!handoff && handoff.status !== 'running';
  }

  private async finish(
    handoffId: string,
    status: AgentHandoffResponseStatus,
    patch: { response?: string | null; failureMessage?: string },
  ): Promise<void> {
    await this.handoffRepo.update(
      { id: handoffId, status: 'running' },
      {
        status,
        ...(patch.response ? { response: patch.response } : {}),
        ...(patch.failureMessage
          ? { failureMessage: patch.failureMessage.slice(0, AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH) }
          : {}),
        finishedAt: new Date(),
      },
    );
  }
}

/** `userMessage` chat event of our own delivery turn (the manager accepted and persisted the message). */
function isUserMessageEventOf(event: unknown, correlationId: string): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }

  const envelope = event as { data?: { kind?: unknown; correlationId?: unknown } };
  const data = envelope.data ?? (event as { kind?: unknown; correlationId?: unknown });

  return data.kind === 'userMessage' && data.correlationId === correlationId;
}
