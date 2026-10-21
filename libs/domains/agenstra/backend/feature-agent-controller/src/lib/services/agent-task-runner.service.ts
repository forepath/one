import {
  AGENT_TASK_ACTIVE_RUN_STATUSES,
  buildAgentTaskResumeSessionSuffix,
} from '@forepath/agenstra/shared/util-opencode-config';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { type FindOptionsWhere, In, IsNull, LessThan, QueryFailedError, Repository } from 'typeorm';

import {
  AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH,
  getAgentHandoffTurnTimeoutMs,
} from '../constants/agent-handoffs.constants';
import {
  AGENT_TASK_RUN_EXCERPT_MAX_LENGTH,
  AGENT_TASK_STALE_RUN_GRACE_MS,
  getAgentTaskHandoffWaitTimeoutMs,
  getAgentTaskRunTimeoutMs,
} from '../constants/agent-tasks.constants';
import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { AGENSTRA_CONTROLLER_QUEUE_NAME } from '../modules/agenstra-notifications.module';
import { enqueueAgentHandoff, isAgentHandoffDeliveryAccepted } from '../utils/agent-handoff-queue.utils';
import { buildAgentTaskRunPrompt, truncateAgentTaskOutput } from '../utils/agent-task-prompt.utils';
import type { AgentTaskOccurrence } from '../utils/agent-task-queue.utils';
import { appendAgentTaskTranscriptEvent, type AgentTaskTranscriptEvent } from '../utils/agent-task-transcript.utils';
import { computeNextAgentTaskRunAt } from '../utils/agent-task-schedule.utils';

import { AgentTaskChatSyncService } from './agent-task-chat-sync.service';
import { AgentTasksService } from './agent-tasks.service';
import { RemoteAgentsSessionService, type RemoteChatStreamingParams } from './remote-agents-session.service';

const FAILURE_MESSAGE_MAX_LENGTH = 512;

/** In-flight transcript snapshots so the session history fills while a long run is still working. */
const AGENT_TASK_TRANSCRIPT_SAVE_INTERVAL_MS = 5_000;

/** Outcome of delivering a handoff response into the task run that made the handoff. */
export type AgentTaskRunHandoffDelivery =
  /** The run continued with the response (its reaction is part of the run). */
  | 'delivered'
  /**
   * Nothing to do here: the run's own turn is still working (it picks the response up when that turn ends), or this
   * response was already delivered / given up by another unit.
   */
  | 'busy'
  /** The task's approval or its approved handoff agents changed while the run waited: not delivered. */
  | 'revoked'
  /** The run (or its task) is gone or already finished: the response cannot land there anymore. */
  | 'ended';

/**
 * Fires recurring agent tasks from the controller queue:
 * - coordinator: claims due occurrences (DB `next_run_at` is the source of truth) and enqueues unit jobs
 * - unit: executes one occurrence in the agent's hidden unattended `-task-{id}` session
 *
 * A run whose turn ends while one of its handoffs is still open waits (`awaiting_handoff`, still the task's one
 * active run); the handoff runner continues it in the same session with the response ({@link continueWithHandoffResponse})
 * and the run ends once it reacted without another open handoff.
 */
@Injectable()
export class AgentTaskRunnerService {
  private readonly logger = new Logger(AgentTaskRunnerService.name);

  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    @InjectRepository(AgentTaskRunEntity)
    private readonly runRepo: Repository<AgentTaskRunEntity>,
    @InjectRepository(AgentHandoffEntity)
    private readonly handoffRepo: Repository<AgentHandoffEntity>,
    private readonly remoteChat: RemoteAgentsSessionService,
    private readonly tasks: AgentTasksService,
    private readonly chatSync: AgentTaskChatSyncService,
    @Optional() @InjectQueue(AGENSTRA_CONTROLLER_QUEUE_NAME) private readonly controllerQueue?: Queue,
  ) {}

  /**
   * Lock due tasks (`SKIP LOCKED`, so parallel coordinators never claim the same row), enqueue each occurrence and
   * advance `next_run_at` in the same transaction: a failed enqueue rolls the claim back (retried next tick), a
   * failed commit after enqueue is harmless because the occurrence is deduplicated by jobId and the unique run row.
   * Missed occurrences (coordinator downtime) collapse into one catch-up run.
   */
  async claimDueOccurrences(
    limit: number,
    enqueue: (occurrence: AgentTaskOccurrence) => Promise<void>,
    now: Date = new Date(),
  ): Promise<number> {
    const claimed = await this.taskRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(AgentTaskEntity);
      const due = await repo
        .createQueryBuilder('t')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('t.enabled = true')
        .andWhere('t.approved_at IS NOT NULL')
        .andWhere('t.next_run_at IS NOT NULL')
        .andWhere('t.next_run_at <= :now', { now })
        .orderBy('t.next_run_at', 'ASC')
        .limit(limit)
        .getMany();

      for (const task of due) {
        await enqueue({
          taskId: task.id,
          scheduledFor: (task.nextRunAt as Date).toISOString(),
          trigger: 'schedule',
        });
        task.nextRunAt = this.nextRunAfter(task, now);
        await repo.update({ id: task.id }, { nextRunAt: task.nextRunAt });
      }

      return due;
    });

    for (const task of claimed) {
      this.tasks.emitTaskUpsert(task);
    }

    return claimed.length;
  }

  /**
   * Mark runs whose worker vanished (restart, lost job) as failed so the task can run again: turns that outlived
   * their timeout, and waiting runs whose handoff was neither answered nor timed out by the handoff coordinator.
   */
  async failStaleRuns(now: Date = new Date()): Promise<number> {
    const turnCutoff = new Date(now.getTime() - getAgentTaskRunTimeoutMs() - AGENT_TASK_STALE_RUN_GRACE_MS);
    const waitCutoff = new Date(
      now.getTime() -
        getAgentTaskHandoffWaitTimeoutMs() -
        getAgentHandoffTurnTimeoutMs() -
        AGENT_TASK_STALE_RUN_GRACE_MS,
    );
    const stale = await this.runRepo.find({
      where: [
        { status: 'running', turnStartedAt: IsNull(), startedAt: LessThan(turnCutoff) },
        { status: 'running', turnStartedAt: LessThan(turnCutoff) },
        { status: 'awaiting_handoff', awaitingHandoffSince: LessThan(waitCutoff) },
      ],
    });

    for (const run of stale) {
      // Only the state observed above: a run claimed by a delivery (or resumed) in between is left alone.
      const observed: FindOptionsWhere<AgentTaskRunEntity> =
        run.status === 'awaiting_handoff'
          ? { status: 'awaiting_handoff', awaitingHandoffSince: run.awaitingHandoffSince ?? IsNull() }
          : { status: 'running', startedAt: run.startedAt, turnStartedAt: run.turnStartedAt ?? IsNull() };

      await this.finishRun(
        run,
        'failed',
        {
          failureMessage:
            run.status === 'awaiting_handoff'
              ? 'The run waited too long for the response to its handoff.'
              : 'The run did not finish (timed out or interrupted).',
        },
        observed,
      );
    }

    return stale.length;
  }

  /** Execute one occurrence. Re-delivered jobs are no-ops thanks to the unique `(task_id, scheduled_for)` row. */
  async executeOccurrence(occurrence: AgentTaskOccurrence): Promise<void> {
    const task = await this.taskRepo.findOne({ where: { id: occurrence.taskId } });

    if (!task || (occurrence.trigger === 'schedule' && !task.enabled)) {
      return;
    }

    // Changed by the agent after this occurrence was queued: never run unapproved instructions.
    if (!task.approvedAt) {
      this.logger.log(`Task ${task.id}: waiting for approval, skipping ${occurrence.scheduledFor}`);

      return;
    }

    // A run waiting for a handoff response still occupies the task.
    if (
      (await this.runRepo.count({ where: { taskId: task.id, status: In([...AGENT_TASK_ACTIVE_RUN_STATUSES]) } })) > 0
    ) {
      this.logger.log(`Task ${task.id}: previous run still in progress, skipping ${occurrence.scheduledFor}`);

      return;
    }

    const scheduledFor = new Date(occurrence.scheduledFor);
    const run = await this.startRun(task, occurrence, scheduledFor);

    if (!run) {
      return;
    }

    const transcript: AgentTaskTranscriptEvent[] = [];

    try {
      // Streaming turn (like plan mode): settles on the terminal assistant message instead of the first agent frame,
      // and every chat event of the turn is kept as the run's session history.
      const result = await this.remoteChat.sendChatStreaming({
        ...this.runTurn(task, run, transcript),
        message: buildAgentTaskRunPrompt(task, occurrence.trigger, scheduledFor),
        correlationId: `agent-task:${run.id}`,
      });

      await this.settleTurn(run, transcript, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Task ${task.id} run ${run.id} failed: ${message}`);
      await this.finishRun(run, 'failed', {
        failureMessage: message.slice(0, FAILURE_MESSAGE_MAX_LENGTH),
        transcript,
      });
    }
  }

  /**
   * Deliver a handoff response into the run that made the handoff: a new turn in the run's own hidden session (never
   * a visible chat), recorded in the run transcript. Only a waiting run is continued — claimed atomically, so a
   * response is delivered at most once even when two units race. `onAccepted` fires when the manager accepted the
   * message (the delivery counts from then on). Throws when the message could not be delivered (the run waits again).
   */
  async continueWithHandoffResponse(
    handoff: AgentHandoffEntity,
    message: string,
    correlationId: string,
    onAccepted: () => Promise<void>,
  ): Promise<AgentTaskRunHandoffDelivery> {
    const run = handoff.sourceTaskRunId
      ? await this.runRepo.findOne({
          where: { id: handoff.sourceTaskRunId, taskId: handoff.sourceTaskId ?? undefined },
        })
      : null;
    const task = run ? await this.taskRepo.findOne({ where: { id: run.taskId } }) : null;

    if (!run || !task || task.clientId !== handoff.clientId || task.agentId !== handoff.sourceAgentId) {
      return 'ended';
    }

    // What a user approved for this run still has to hold when the peer's text reaches the unattended session.
    if (!task.approvedAt || !(task.allowedHandoffAgentIds ?? []).includes(handoff.targetAgentId)) {
      return 'revoked';
    }

    const waitingSince = run.awaitingHandoffSince ?? null;
    const turnStartedAt = new Date();
    // Atomic: the run waits, and for a response of this handoff that has not landed yet (another unit may have
    // delivered it, after which the run can be waiting for a newer handoff).
    const claimed = await this.runRepo
      .createQueryBuilder()
      .update(AgentTaskRunEntity)
      .set({ status: 'running', awaitingHandoffSince: null, turnStartedAt })
      .where('id = :runId', { runId: run.id })
      .andWhere("status = 'awaiting_handoff'")
      .andWhere(
        'EXISTS (SELECT 1 FROM agent_handoffs h WHERE h.id = :handoffId AND h.source_task_run_id = :runId ' +
          'AND h.delivered_at IS NULL AND h.delivery_failure_message IS NULL)',
        { handoffId: handoff.id },
      )
      // Approval and target re-checked in the same statement (the check above only explains a refusal).
      .andWhere(
        'EXISTS (SELECT 1 FROM agent_tasks t WHERE t.id = :taskId AND t.approved_at IS NOT NULL ' +
          'AND t.allowed_handoff_agent_ids @> jsonb_build_array(CAST(:targetAgentId AS text)))',
        { taskId: task.id, targetAgentId: handoff.targetAgentId },
      )
      .execute();

    if (!claimed.affected) {
      const [current, latest] = await Promise.all([
        this.runRepo.findOne({ where: { id: run.id } }),
        this.handoffRepo.findOne({ where: { id: handoff.id } }),
      ]);

      // Delivered / given up by another unit, or the run's own turn still works: nothing to do here.
      if (!latest || latest.deliveredAt || latest.deliveryFailureMessage || current?.status === 'running') {
        return 'busy';
      }

      return current?.status === 'awaiting_handoff' ? 'busy' : 'ended';
    }

    Object.assign(run, { status: 'running', awaitingHandoffSince: null, turnStartedAt });
    await this.taskRepo.update({ id: task.id }, { lastRunStatus: 'running' });
    await this.publish(task.id, run);

    const transcript = [...(run.transcript ?? [])];
    let accepted = false;
    const accept = async (): Promise<void> => {
      if (!accepted) {
        accepted = true;
        await onAccepted();
      }
    };

    try {
      const turn = this.runTurn(task, run, transcript);
      const result = await this.remoteChat.sendChatStreaming({
        ...turn,
        message,
        correlationId,
        onEvent: async (event) => {
          if (isAgentHandoffDeliveryAccepted(event, correlationId)) {
            await accept();
          }

          await turn.onEvent?.(event);
        },
      });

      await accept();
      await this.settleTurn(run, transcript, result.text);

      return 'delivered';
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);

      if (!accepted) {
        // Never reached the agent: the run waits again and the handoff runner retries the delivery.
        await this.runRepo.update(
          { id: run.id, status: 'running' },
          { status: 'awaiting_handoff', awaitingHandoffSince: waitingSince ?? new Date(), transcript },
        );
        Object.assign(run, { status: 'awaiting_handoff', awaitingHandoffSince: waitingSince ?? new Date() });
        await this.taskRepo.update({ id: task.id }, { lastRunStatus: 'awaiting_handoff' });
        await this.publish(task.id, run);

        throw error;
      }

      this.logger.warn(`Task ${task.id} run ${run.id}: turn after handoff response failed: ${failure}`);
      await this.finishRun(run, 'failed', { failureMessage: failure.slice(0, FAILURE_MESSAGE_MAX_LENGTH), transcript });

      return 'delivered';
    }
  }

  /**
   * A handoff of this run can no longer be delivered (gave up): a run that only waited for it ends, failed, with the
   * reason (there is no session turn left to tell it).
   */
  async onHandoffUndeliverable(handoff: AgentHandoffEntity, reason: string): Promise<void> {
    if (!handoff.sourceTaskRunId) {
      return;
    }

    const run = await this.runRepo.findOne({ where: { id: handoff.sourceTaskRunId } });

    if (!run || run.status !== 'awaiting_handoff' || (await this.openHandoffs(run.id)).length > 0) {
      return;
    }

    await this.finishRun(run, 'failed', {
      failureMessage: `The response of the handoff "${handoff.title}" could not be delivered: ${reason}`.slice(
        0,
        FAILURE_MESSAGE_MAX_LENGTH,
      ),
    });
  }

  /** Everything a turn of the run sends: same hidden session, model and (no extra) context for every turn. */
  private runTurn(
    task: AgentTaskEntity,
    run: AgentTaskRunEntity,
    transcript: AgentTaskTranscriptEvent[],
  ): Omit<RemoteChatStreamingParams, 'message' | 'correlationId'> {
    let lastTranscriptSaveAt = Date.now();

    return {
      clientId: task.clientId,
      agentId: task.agentId,
      continue: true,
      resumeSessionSuffix: buildAgentTaskResumeSessionSuffix(task.id),
      ephemeral: true,
      unattendedAutomation: true,
      model: task.model,
      statisticsInteractionKind: StatisticsInteractionKind.AGENT_TASK_RUN,
      chatTimeoutMs: getAgentTaskRunTimeoutMs(),
      contextInjection: { includeWorkspace: true, environmentIds: [task.agentId], autoEnrichmentEnabled: false },
      onEvent: async (event) => {
        if (!appendAgentTaskTranscriptEvent(transcript, event)) {
          return;
        }

        if (Date.now() - lastTranscriptSaveAt >= AGENT_TASK_TRANSCRIPT_SAVE_INTERVAL_MS) {
          lastTranscriptSaveAt = Date.now();
          await this.runRepo.update({ id: run.id }, { transcript: [...transcript] });
        }
      },
    };
  }

  /**
   * After a turn of the run: finished unless one of its handoffs is still open — then it waits for the response.
   * Responses that arrived while this turn was still working are delivered right away.
   */
  private async settleTurn(
    run: AgentTaskRunEntity,
    transcript: AgentTaskTranscriptEvent[],
    text: string,
  ): Promise<void> {
    const outputExcerpt = truncateAgentTaskOutput(text, AGENT_TASK_RUN_EXCERPT_MAX_LENGTH) || null;
    const open = await this.openHandoffs(run.id);

    if (open.length === 0) {
      await this.finishRun(run, 'succeeded', { outputExcerpt, transcript });

      return;
    }

    const awaitingHandoffSince = new Date();
    const patch = { status: 'awaiting_handoff' as const, awaitingHandoffSince, transcript, outputExcerpt };
    const waiting = await this.runRepo.update({ id: run.id, status: 'running' }, patch);

    if (!waiting.affected) {
      return;
    }

    Object.assign(run, patch);
    await this.taskRepo.update({ id: run.taskId }, { lastRunStatus: 'awaiting_handoff' });
    await this.publish(run.taskId, run);

    // Read again after the run started waiting: a response finishing in between saw a working run ('busy') and
    // left the delivery to this turn.
    for (const handoff of await this.openHandoffs(run.id)) {
      if (handoff.status === 'completed' || handoff.status === 'failed') {
        await this.enqueueDelivery(handoff.id);
      }
    }
  }

  /** Handoffs of the run whose response has not landed in it yet (and still can). */
  private openHandoffs(runId: string): Promise<AgentHandoffEntity[]> {
    return this.handoffRepo.find({
      where: { sourceTaskRunId: runId, deliveredAt: IsNull(), deliveryFailureMessage: IsNull() },
    });
  }

  private async enqueueDelivery(handoffId: string): Promise<void> {
    if (!this.controllerQueue) {
      return;
    }

    try {
      await enqueueAgentHandoff(this.controllerQueue, { handoffId }, { delivery: true });
    } catch (error) {
      // The handoff coordinator re-enqueues undelivered responses.
      this.logger.warn(
        `Handoff ${handoffId}: delivery enqueue failed, coordinator retries: ${(error as Error).message}`,
      );
    }
  }

  private async startRun(
    task: AgentTaskEntity,
    occurrence: AgentTaskOccurrence,
    scheduledFor: Date,
  ): Promise<AgentTaskRunEntity | null> {
    let run: AgentTaskRunEntity;

    try {
      run = await this.runRepo.save(
        this.runRepo.create({
          taskId: task.id,
          clientId: task.clientId,
          agentId: task.agentId,
          trigger: occurrence.trigger,
          status: 'running',
          scheduledFor,
          startedAt: new Date(),
        }),
      );
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.debug(`Task ${task.id}: occurrence ${occurrence.scheduledFor} already handled`);

        return null;
      }

      throw error;
    }

    await this.taskRepo.update({ id: task.id }, { lastRunAt: run.startedAt, lastRunStatus: 'running' });
    await this.publish(task.id, run);

    return run;
  }

  /**
   * End an active run (conditional: a run finished meanwhile is left alone). Handoffs of the run that are still
   * open can no longer land anywhere and are marked undeliverable (their targets keep their chats).
   */
  private async finishRun(
    run: AgentTaskRunEntity,
    status: 'succeeded' | 'failed',
    patch: Pick<Partial<AgentTaskRunEntity>, 'outputExcerpt' | 'failureMessage' | 'transcript'>,
    observed: FindOptionsWhere<AgentTaskRunEntity> = { status: In([...AGENT_TASK_ACTIVE_RUN_STATUSES]) },
  ): Promise<void> {
    const finished = {
      ...patch,
      status,
      finishedAt: new Date(),
      awaitingHandoffSince: null,
    };
    const result = await this.runRepo.update({ ...observed, id: run.id }, finished);

    if (!result.affected) {
      return;
    }

    Object.assign(run, finished);
    await this.handoffRepo.update(
      { sourceTaskRunId: run.id, deliveredAt: IsNull(), deliveryFailureMessage: IsNull() },
      {
        deliveryFailureMessage: 'The task run that made this handoff ended before the response arrived.'.slice(
          0,
          AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH,
        ),
      },
    );
    await this.taskRepo.update({ id: run.taskId }, { lastRunStatus: status });
    await this.publish(run.taskId, run);
  }

  /** Chat card + `/tasks` row; the task may have been deleted meanwhile (run rows cascade with it). */
  private async publish(taskId: string, run: AgentTaskRunEntity): Promise<void> {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });

    if (!task) {
      return;
    }

    this.chatSync.emitLiveRunUpdate(task, run);
    this.tasks.emitTaskUpsert(task);
  }

  private nextRunAfter(task: AgentTaskEntity, now: Date): Date | null {
    try {
      return computeNextAgentTaskRunAt(task.cronExpression, task.timezone, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Task ${task.id}: schedule no longer valid, pausing it: ${message}`);

      return null;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    return (error.driverError as { code?: string } | undefined)?.code === '23505';
  }
}
