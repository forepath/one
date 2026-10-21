import type { AgentHandoffResponseStatus } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';

import { getAgentTaskHandoffWaitTimeoutMs } from '../constants/agent-tasks.constants';

import {
  AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH,
  AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS,
  AGENT_HANDOFF_REQUEUE_AFTER_MS,
  AGENT_HANDOFF_RESPONSE_REPAIR_ATTEMPTS,
  AGENT_HANDOFF_STALE_GRACE_MS,
  getAgentHandoffTurnTimeoutMs,
} from '../constants/agent-handoffs.constants';
import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import {
  buildAgentHandoffDeliveryMessage,
  buildAgentHandoffFallbackResponse,
  buildAgentHandoffRepairPrompt,
  buildAgentHandoffTargetMessage,
} from '../utils/agent-handoff-prompt.utils';
import {
  agentHandoffDeliveryCorrelationId,
  isAgentHandoffDeliveryAccepted,
  type AgentHandoffJob,
} from '../utils/agent-handoff-queue.utils';

import { AgentTaskRunnerService } from './agent-task-runner.service';
import { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

/** Enqueue a unit again; `delivery` uses the delivery jobId (does not wait for a unit still in flight). */
type EnqueueAgentHandoff = (job: AgentHandoffJob, options?: { delivery?: boolean }) => Promise<void>;

/**
 * Executes handoffs from the controller queue:
 * - unit: runs the target turn in its visible handoff chat (repair turns until it answered with
 *   `agenstra_handoff_respond`, like chat plan repair turns) and delivers the outcome into the source chat
 * - coordinator: fails stalled runs and re-enqueues lost units / undelivered responses
 *
 * Every terminal state (answered, platform fallback, error, timeout, interruption) ends in a response delivered
 * where the handoff was made — the source chat, or the session of the source task run — never anywhere else. When
 * that chat is gone or the run ended the handoff is marked undeliverable (reported by `agenstra_handoff_get`).
 */
@Injectable()
export class AgentHandoffRunnerService {
  private readonly logger = new Logger(AgentHandoffRunnerService.name);

  constructor(
    @InjectRepository(AgentHandoffEntity)
    private readonly handoffRepo: Repository<AgentHandoffEntity>,
    private readonly remoteChat: RemoteAgentsSessionService,
    private readonly chatsProxy: ClientAgentChatsProxyService,
    private readonly taskRunner: AgentTaskRunnerService,
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
   * Coordinator tick: units that died mid-run (worker restart) are failed and delivered; handoffs a task run waited
   * on for too long are failed and delivered into the run (it decides without them); pending units and undelivered
   * responses whose job got lost are enqueued again.
   */
  async sweep(enqueue: EnqueueAgentHandoff, now: Date = new Date()): Promise<number> {
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
    const timedOut = await this.failHandoffsRunsStoppedWaitingFor(now);
    const ids = new Set([...stale, ...due].map((handoff) => handoff.id));

    for (const handoffId of ids) {
      await enqueue({ handoffId });
    }

    // The target may still be working in its unit: deliver through the separate delivery unit.
    for (const handoffId of timedOut) {
      await enqueue({ handoffId }, { delivery: true });
    }

    return new Set([...ids, ...timedOut]).size;
  }

  /** Open handoffs of runs that waited longer than the handoff wait timeout: failed with a clear reason. */
  private async failHandoffsRunsStoppedWaitingFor(now: Date): Promise<string[]> {
    const waitMs = getAgentTaskHandoffWaitTimeoutMs();
    const overdue = await this.handoffRepo
      .createQueryBuilder('h')
      .innerJoin(AgentTaskRunEntity, 'r', 'r.id = h.source_task_run_id')
      .where('h.status IN (:...open)', { open: ['pending', 'running'] })
      .andWhere("r.status = 'awaiting_handoff'")
      .andWhere('r.awaiting_handoff_since < :cutoff', { cutoff: new Date(now.getTime() - waitMs) })
      .getMany();
    const failed: string[] = [];

    for (const handoff of overdue) {
      const result = await this.handoffRepo.update(
        { id: handoff.id, status: In(['pending', 'running']) },
        {
          status: 'failed',
          failureMessage:
            `The agent "${handoff.targetAgentName}" did not answer within ${Math.round(waitMs / 60_000)} minutes; ` +
            'the task run stopped waiting for it.',
          finishedAt: now,
        },
      );

      if (result.affected) {
        failed.push(handoff.id);
      }
    }

    return failed;
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
    if (handoff.sourceTaskRunId) {
      await this.deliverToTaskRun(handoff, status);

      return;
    }

    if (!handoff.sourceChatId) {
      await this.markUndeliverable(handoff, 'The handoff has no requesting chat.');

      return;
    }

    const sourceChatId = handoff.sourceChatId;
    const correlationId = agentHandoffDeliveryCorrelationId(handoff.id);
    let accepted = false;
    const markDelivered = async (): Promise<void> => {
      if (!accepted) {
        accepted = true;
        await this.handoffRepo.update({ id: handoff.id }, { deliveredAt: new Date() });
      }
    };

    try {
      if (!(await this.chatExists(handoff.clientId, handoff.sourceAgentId, sourceChatId))) {
        await this.markUndeliverable(handoff, 'The requesting chat no longer exists.');

        return;
      }

      await this.remoteChat.sendChatStreaming({
        clientId: handoff.clientId,
        agentId: handoff.sourceAgentId,
        chatId: sourceChatId,
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
          if (isAgentHandoffDeliveryAccepted(event, correlationId)) {
            await markDelivered();
          }
        },
      });
      await markDelivered();
      await this.markDeliveryTurnEnded(handoff.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (accepted) {
        this.logger.debug(`Handoff ${handoff.id}: response delivered, source turn ended with: ${message}`);
        await this.markDeliveryTurnEnded(handoff.id);

        return;
      }

      await this.handoffRepo.increment({ id: handoff.id }, 'deliveryAttempts', 1);
      this.logger.warn(`Handoff ${handoff.id}: response delivery failed: ${message}`);

      if (handoff.deliveryAttempts + 1 >= AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS) {
        await this.markUndeliverable(
          handoff,
          `The response could not be delivered after ${AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS} attempts: ${message}`,
        );

        return;
      }

      throw error;
    }
  }

  /**
   * Continue the task run that made the handoff with the outcome, in the run's own hidden session. A run whose own
   * turn is still working picks the response up when that turn ends; a finished run cannot receive it anymore.
   */
  private async deliverToTaskRun(handoff: AgentHandoffEntity, status: AgentHandoffResponseStatus): Promise<void> {
    let accepted = false;

    try {
      const outcome = await this.taskRunner.continueWithHandoffResponse(
        handoff,
        buildAgentHandoffDeliveryMessage(handoff, status),
        agentHandoffDeliveryCorrelationId(handoff.id),
        async () => {
          accepted = true;
          await this.handoffRepo.update({ id: handoff.id }, { deliveredAt: new Date() });
        },
      );

      if (outcome === 'ended') {
        await this.markUndeliverable(handoff, 'The task run that made this handoff has already ended.');
      } else if (outcome === 'revoked') {
        await this.markUndeliverable(
          handoff,
          'The task was changed while its run waited (approval or allowed handoff agents); the response was not ' +
            'delivered.',
        );
      } else if (outcome === 'delivered') {
        await this.markDeliveryTurnEnded(handoff.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (accepted) {
        await this.markDeliveryTurnEnded(handoff.id);

        return;
      }

      await this.handoffRepo.increment({ id: handoff.id }, 'deliveryAttempts', 1);
      this.logger.warn(`Handoff ${handoff.id}: response delivery into the task run failed: ${message}`);

      if (handoff.deliveryAttempts + 1 >= AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS) {
        await this.markUndeliverable(
          handoff,
          `The response could not be delivered after ${AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS} attempts: ${message}`,
        );

        return;
      }

      throw error;
    }
  }

  /** Handoffs created after this in the source chat no longer continue this handoff's chain. */
  private async markDeliveryTurnEnded(handoffId: string): Promise<void> {
    await this.handoffRepo.update({ id: handoffId }, { deliveryTurnEndedAt: new Date() });
  }

  private async markUndeliverable(handoff: AgentHandoffEntity, message: string): Promise<void> {
    // Only while the response is still open: a response another unit delivered meanwhile stays delivered.
    const result = await this.handoffRepo.update(
      { id: handoff.id, deliveredAt: IsNull(), deliveryFailureMessage: IsNull() },
      { deliveryFailureMessage: message.slice(0, AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH) },
    );

    if (!result.affected) {
      return;
    }

    this.logger.warn(`Handoff ${handoff.id}: response undeliverable: ${message}`);
    // A run that only waited for this response would wait forever otherwise.
    await this.taskRunner.onHandoffUndeliverable(handoff, message);
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
