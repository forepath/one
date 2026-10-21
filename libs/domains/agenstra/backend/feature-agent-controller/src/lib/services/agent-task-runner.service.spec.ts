import { QueryFailedError, type Repository } from 'typeorm';

import type { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import type { AgentTaskEntity } from '../entities/agent-task.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';

import type { AgentTaskChatSyncService } from './agent-task-chat-sync.service';
import { AgentTaskRunnerService } from './agent-task-runner.service';
import type { AgentTasksService } from './agent-tasks.service';
import type { RemoteAgentsSessionService } from './remote-agents-session.service';

describe('AgentTaskRunnerService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const taskId = '00000000-0000-4000-8000-000000000030';
  const now = new Date('2026-10-21T09:00:30.000Z');
  let task: AgentTaskEntity;
  let taskRepo: { findOne: jest.Mock; update: jest.Mock; manager: { transaction: jest.Mock } };
  let txRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let queryBuilder: Record<string, jest.Mock>;
  let runRepo: { count: jest.Mock; create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let remoteChat: { sendChatStreaming: jest.Mock };
  let tasks: { emitTaskUpsert: jest.Mock };
  let chatSync: { emitLiveRunUpdate: jest.Mock };
  let runner: AgentTaskRunnerService;

  beforeEach(() => {
    task = {
      id: taskId,
      clientId,
      agentId,
      title: 'Daily report',
      prompt: 'Summarize',
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
      model: 'openai/gpt-5',
      enabled: true,
      nextRunAt: new Date('2026-10-21T09:00:00.000Z'),
    } as AgentTaskEntity;
    queryBuilder = {};

    for (const method of ['setLock', 'setOnLocked', 'where', 'andWhere', 'orderBy', 'limit']) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }

    queryBuilder['getMany'] = jest.fn().mockResolvedValue([task]);
    txRepo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder), update: jest.fn() };
    taskRepo = {
      findOne: jest.fn().mockResolvedValue(task),
      update: jest.fn(),
      manager: {
        transaction: jest.fn(async (work: (em: unknown) => Promise<unknown>) => work({ getRepository: () => txRepo })),
      },
    };
    runRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((row: Partial<AgentTaskRunEntity>) => row),
      save: jest.fn(async (row: Partial<AgentTaskRunEntity>) => ({ id: 'run-1', ...row })),
      find: jest.fn().mockResolvedValue([]),
    };
    remoteChat = { sendChatStreaming: jest.fn().mockResolvedValue({ text: 'All good.' }) };
    tasks = { emitTaskUpsert: jest.fn() };
    chatSync = { emitLiveRunUpdate: jest.fn() };
    runner = new AgentTaskRunnerService(
      taskRepo as unknown as Repository<AgentTaskEntity>,
      runRepo as unknown as Repository<AgentTaskRunEntity>,
      remoteChat as unknown as RemoteAgentsSessionService,
      tasks as unknown as AgentTasksService,
      chatSync as unknown as AgentTaskChatSyncService,
    );
  });

  describe('claimDueOccurrences', () => {
    it('locks due tasks, enqueues the occurrence and advances next_run_at', async () => {
      const enqueue = jest.fn().mockResolvedValue(undefined);

      await expect(runner.claimDueOccurrences(10, enqueue, now)).resolves.toBe(1);

      expect(queryBuilder['setOnLocked']).toHaveBeenCalledWith('skip_locked');
      expect(enqueue).toHaveBeenCalledWith({
        taskId,
        scheduledFor: '2026-10-21T09:00:00.000Z',
        trigger: 'schedule',
      });
      expect(txRepo.update).toHaveBeenCalledWith({ id: taskId }, { nextRunAt: new Date('2026-10-22T09:00:00.000Z') });
      expect(tasks.emitTaskUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: taskId }));
    });

    it('does not advance the schedule when enqueueing fails (claim is rolled back)', async () => {
      const enqueue = jest.fn().mockRejectedValue(new Error('redis down'));

      await expect(runner.claimDueOccurrences(10, enqueue, now)).rejects.toThrow('redis down');
      expect(txRepo.update).not.toHaveBeenCalled();
      expect(tasks.emitTaskUpsert).not.toHaveBeenCalled();
    });

    it('collapses missed occurrences into one catch-up run', async () => {
      task.nextRunAt = new Date('2026-10-18T09:00:00.000Z');

      await runner.claimDueOccurrences(10, jest.fn(), now);

      expect(txRepo.update).toHaveBeenCalledWith({ id: taskId }, { nextRunAt: new Date('2026-10-22T09:00:00.000Z') });
    });
  });

  describe('executeOccurrence', () => {
    const occurrence = { taskId, scheduledFor: '2026-10-21T09:00:00.000Z', trigger: 'schedule' as const };

    it('runs the task in its unattended session and stores the result', async () => {
      await runner.executeOccurrence(occurrence);

      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId,
          clientId,
          agentId,
          status: 'running',
          trigger: 'schedule',
          scheduledFor: new Date(occurrence.scheduledFor),
        }),
      );
      expect(remoteChat.sendChatStreaming).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId,
          agentId,
          resumeSessionSuffix: `-task-${taskId}`,
          model: 'openai/gpt-5',
          statisticsInteractionKind: StatisticsInteractionKind.AGENT_TASK_RUN,
          message: expect.stringContaining('Summarize'),
        }),
      );
      expect(runRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'succeeded', outputExcerpt: 'All good.', finishedAt: expect.any(Date) }),
      );
      expect(taskRepo.update).toHaveBeenLastCalledWith({ id: taskId }, { lastRunStatus: 'succeeded' });
      expect(chatSync.emitLiveRunUpdate).toHaveBeenCalledTimes(2);
    });

    it('streams the turn unattended and stores its chat events as transcript', async () => {
      const event = (kind: string, payload: Record<string, unknown>) => ({
        success: true,
        data: { eventId: `e-${kind}`, kind, payload },
      });

      remoteChat.sendChatStreaming.mockImplementation(
        async (params: { onEvent: (event: unknown) => Promise<void> }) => {
          await params.onEvent(event('thinking', { phase: 'running' }));
          await params.onEvent(event('assistantDelta', { delta: 'Do' }));
          await params.onEvent(event('assistantMessage', { text: 'Done.' }));

          return { text: 'Done.' };
        },
      );

      await runner.executeOccurrence(occurrence);

      expect(remoteChat.sendChatStreaming).toHaveBeenCalledWith(
        expect.objectContaining({ ephemeral: true, unattendedAutomation: true }),
      );

      const saved = runRepo.save.mock.calls[runRepo.save.mock.calls.length - 1][0] as AgentTaskRunEntity;

      expect(saved.outputExcerpt).toBe('Done.');
      expect(saved.transcript?.map((entry) => (entry.payload as { data: { kind: string } }).data.kind)).toEqual([
        'thinking',
        'assistantMessage',
      ]);
    });

    it('keeps the transcript of failed runs', async () => {
      remoteChat.sendChatStreaming.mockImplementation(
        async (params: { onEvent: (event: unknown) => Promise<void> }) => {
          await params.onEvent({ success: true, data: { eventId: 'e1', kind: 'toolCall', payload: { name: 'bash' } } });

          throw new Error('Remote chat failed');
        },
      );

      await runner.executeOccurrence(occurrence);

      expect(runRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: 'failed',
          transcript: [expect.objectContaining({ timestamp: expect.any(Number) })],
        }),
      );
    });

    it('records agent failures on the run', async () => {
      remoteChat.sendChatStreaming.mockRejectedValue(new Error('Timed out waiting for agent chat response'));

      await runner.executeOccurrence(occurrence);

      expect(runRepo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'failed', failureMessage: 'Timed out waiting for agent chat response' }),
      );
      expect(taskRepo.update).toHaveBeenLastCalledWith({ id: taskId }, { lastRunStatus: 'failed' });
    });

    it('skips disabled tasks for scheduled occurrences but not manual runs', async () => {
      task.enabled = false;

      await runner.executeOccurrence(occurrence);
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();

      await runner.executeOccurrence({ ...occurrence, trigger: 'manual' });
      expect(remoteChat.sendChatStreaming).toHaveBeenCalled();
    });

    it('skips while a previous run is still in progress', async () => {
      runRepo.count.mockResolvedValue(1);

      await runner.executeOccurrence(occurrence);

      expect(runRepo.save).not.toHaveBeenCalled();
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    it('ignores re-delivered occurrences (unique run row)', async () => {
      runRepo.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate'), { code: '23505' })),
      );

      await runner.executeOccurrence(occurrence);

      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    it('ignores deleted tasks', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await runner.executeOccurrence(occurrence);

      expect(runRepo.save).not.toHaveBeenCalled();
    });
  });

  it('fails runs that outlived their timeout', async () => {
    const stale = { id: 'run-old', taskId, clientId, agentId, status: 'running' } as AgentTaskRunEntity;

    runRepo.find.mockResolvedValue([stale]);

    await expect(runner.failStaleRuns(now)).resolves.toBe(1);
    expect(runRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-old', status: 'failed' }));
    expect(taskRepo.update).toHaveBeenCalledWith({ id: taskId }, { lastRunStatus: 'failed' });
  });
});
