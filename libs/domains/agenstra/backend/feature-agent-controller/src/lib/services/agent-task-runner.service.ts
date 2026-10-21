import { buildAgentTaskResumeSessionSuffix } from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, QueryFailedError, Repository } from 'typeorm';

import {
  AGENT_TASK_RUN_EXCERPT_MAX_LENGTH,
  AGENT_TASK_STALE_RUN_GRACE_MS,
  getAgentTaskRunTimeoutMs,
} from '../constants/agent-tasks.constants';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';
import { buildAgentTaskRunPrompt, truncateAgentTaskOutput } from '../utils/agent-task-prompt.utils';
import type { AgentTaskOccurrence } from '../utils/agent-task-queue.utils';
import { appendAgentTaskTranscriptEvent, type AgentTaskTranscriptEvent } from '../utils/agent-task-transcript.utils';
import { computeNextAgentTaskRunAt } from '../utils/agent-task-schedule.utils';

import { AgentTaskChatSyncService } from './agent-task-chat-sync.service';
import { AgentTasksService } from './agent-tasks.service';
import { RemoteAgentsSessionService } from './remote-agents-session.service';

const FAILURE_MESSAGE_MAX_LENGTH = 512;

/** In-flight transcript snapshots so the session history fills while a long run is still working. */
const AGENT_TASK_TRANSCRIPT_SAVE_INTERVAL_MS = 5_000;

/**
 * Fires recurring agent tasks from the controller queue:
 * - coordinator: claims due occurrences (DB `next_run_at` is the source of truth) and enqueues unit jobs
 * - unit: executes one occurrence in the agent's hidden unattended `-task-{id}` session
 */
@Injectable()
export class AgentTaskRunnerService {
  private readonly logger = new Logger(AgentTaskRunnerService.name);

  constructor(
    @InjectRepository(AgentTaskEntity)
    private readonly taskRepo: Repository<AgentTaskEntity>,
    @InjectRepository(AgentTaskRunEntity)
    private readonly runRepo: Repository<AgentTaskRunEntity>,
    private readonly remoteChat: RemoteAgentsSessionService,
    private readonly tasks: AgentTasksService,
    private readonly chatSync: AgentTaskChatSyncService,
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

  /** Mark runs whose worker vanished (restart, lost job) as failed so the task can run again. */
  async failStaleRuns(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - getAgentTaskRunTimeoutMs() - AGENT_TASK_STALE_RUN_GRACE_MS);
    const stale = await this.runRepo.find({ where: { status: 'running', startedAt: LessThan(cutoff) } });

    for (const run of stale) {
      await this.finishRun(run, 'failed', { failureMessage: 'The run did not finish (timed out or interrupted).' });
    }

    return stale.length;
  }

  /** Execute one occurrence. Re-delivered jobs are no-ops thanks to the unique `(task_id, scheduled_for)` row. */
  async executeOccurrence(occurrence: AgentTaskOccurrence): Promise<void> {
    const task = await this.taskRepo.findOne({ where: { id: occurrence.taskId } });

    if (!task || (occurrence.trigger === 'schedule' && !task.enabled)) {
      return;
    }

    if ((await this.runRepo.count({ where: { taskId: task.id, status: 'running' } })) > 0) {
      this.logger.log(`Task ${task.id}: previous run still in progress, skipping ${occurrence.scheduledFor}`);

      return;
    }

    const scheduledFor = new Date(occurrence.scheduledFor);
    const run = await this.startRun(task, occurrence, scheduledFor);

    if (!run) {
      return;
    }

    const transcript: AgentTaskTranscriptEvent[] = [];
    let lastTranscriptSaveAt = Date.now();

    try {
      // Streaming turn (like plan mode): settles on the terminal assistant message instead of the first agent frame,
      // and every chat event of the turn is kept as the run's session history.
      const result = await this.remoteChat.sendChatStreaming({
        clientId: task.clientId,
        agentId: task.agentId,
        message: buildAgentTaskRunPrompt(task, occurrence.trigger, scheduledFor),
        correlationId: `agent-task:${run.id}`,
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
      });

      await this.finishRun(run, 'succeeded', {
        outputExcerpt: truncateAgentTaskOutput(result.text, AGENT_TASK_RUN_EXCERPT_MAX_LENGTH) || null,
        transcript,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Task ${task.id} run ${run.id} failed: ${message}`);
      await this.finishRun(run, 'failed', {
        failureMessage: message.slice(0, FAILURE_MESSAGE_MAX_LENGTH),
        transcript,
      });
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

  private async finishRun(
    run: AgentTaskRunEntity,
    status: 'succeeded' | 'failed',
    patch: Pick<Partial<AgentTaskRunEntity>, 'outputExcerpt' | 'failureMessage' | 'transcript'>,
  ): Promise<void> {
    Object.assign(run, patch, { status, finishedAt: new Date() });
    await this.runRepo.save(run);
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
