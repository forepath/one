import type { Queue } from 'bullmq';
import { FindOperator, QueryFailedError, type Repository } from 'typeorm';

import type { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import type { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import type { AgentTaskEntity } from '../entities/agent-task.entity';
import { StatisticsInteractionKind } from '../entities/statistics-chat-io.entity';

import type { AgentTaskChatSyncService } from './agent-task-chat-sync.service';
import { AgentTaskRunnerService } from './agent-task-runner.service';
import type { AgentTasksService } from './agent-tasks.service';
import type { RemoteAgentsSessionService } from './remote-agents-session.service';

/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory repository doubles */

/** Minimal TypeORM `where` matching (plain values, `In`, `IsNull`, `LessThan`) for the in-memory rows. */
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];

    if (expected instanceof FindOperator) {
      const value = (expected as any)._value;

      switch ((expected as any)._type) {
        case 'in':
          return (value as unknown[]).includes(actual);
        case 'isNull':
          return actual === null || actual === undefined;
        case 'lessThan':
          return actual instanceof Date && actual < value;
        default:
          throw new Error(`Unsupported operator ${(expected as any)._type}`);
      }
    }

    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }

    return actual === expected;
  });
}

function table<T extends { id: string }>(rows: T[]) {
  const find = (where: any) => (Array.isArray(where) ? where : [where]);

  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      const row = rows.find((candidate) => find(where).some((w: any) => matches(candidate, w)));

      return row ? { ...row } : null;
    }),
    find: jest.fn(async ({ where }: any) =>
      rows.filter((row) => find(where).some((w: any) => matches(row, w))).map((row) => ({ ...row })),
    ),
    count: jest.fn(async ({ where }: any) => rows.filter((row) => matches(row, where)).length),
    update: jest.fn(async (where: any, patch: any) => {
      const hits = rows.filter((row) => matches(row, where));

      for (const row of hits) {
        Object.assign(row, patch);
      }

      return { affected: hits.length };
    }),
  };
}

describe('AgentTaskRunnerService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const taskId = '00000000-0000-4000-8000-000000000030';
  const now = new Date('2026-10-21T09:00:30.000Z');
  let task: AgentTaskEntity;
  let taskRepo: { findOne: jest.Mock; update: jest.Mock; manager: { transaction: jest.Mock } };
  let txRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let queryBuilder: Record<string, jest.Mock>;
  let runs: ReturnType<typeof table<AgentTaskRunEntity>> & { create: jest.Mock; save: jest.Mock };
  let handoffs: ReturnType<typeof table<AgentHandoffEntity>>;
  let remoteChat: { sendChatStreaming: jest.Mock };
  let tasks: { emitTaskUpsert: jest.Mock };
  let chatSync: { emitLiveRunUpdate: jest.Mock };
  let queue: { getJob: jest.Mock; add: jest.Mock };
  let runner: AgentTaskRunnerService;

  const run = (overrides: Partial<AgentTaskRunEntity> = {}): AgentTaskRunEntity =>
    ({
      id: 'run-1',
      taskId,
      clientId,
      agentId,
      trigger: 'schedule',
      status: 'running',
      scheduledFor: new Date('2026-10-21T09:00:00.000Z'),
      startedAt: new Date('2026-10-21T09:00:00.000Z'),
      transcript: [],
      ...overrides,
    }) as AgentTaskRunEntity;

  const handoff = (overrides: Partial<AgentHandoffEntity> = {}): AgentHandoffEntity =>
    ({
      id: 'handoff-1',
      clientId,
      sourceAgentId: agentId,
      sourceChatId: null,
      sourceTaskId: taskId,
      sourceTaskRunId: 'run-1',
      title: 'Ask the reviewer',
      targetAgentId: 'agent-b',
      status: 'running',
      deliveredAt: null,
      deliveryFailureMessage: null,
      ...overrides,
    }) as AgentHandoffEntity;

  const event = (kind: string, payload: Record<string, unknown>, correlationId?: string) => ({
    success: true,
    data: { eventId: `e-${kind}`, kind, payload, ...(correlationId ? { correlationId } : {}) },
  });

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
      allowedHandoffAgentIds: [],
      nextRunAt: new Date('2026-10-21T09:00:00.000Z'),
      approvedAt: new Date('2026-10-21T08:00:00.000Z'),
    } as AgentTaskEntity;
    task.allowedHandoffAgentIds = ['agent-b'];
    queryBuilder = {};

    for (const method of ['setLock', 'setOnLocked', 'where', 'andWhere', 'orderBy', 'limit']) {
      queryBuilder[method] = jest.fn().mockReturnValue(queryBuilder);
    }

    queryBuilder['getMany'] = jest.fn().mockResolvedValue([task]);
    txRepo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder), update: jest.fn() };
    taskRepo = {
      findOne: jest.fn().mockImplementation(async () => task),
      update: jest.fn(),
      manager: {
        transaction: jest.fn(async (work: (em: unknown) => Promise<unknown>) => work({ getRepository: () => txRepo })),
      },
    };
    const runTable = table<AgentTaskRunEntity>([]);

    runs = Object.assign(runTable, {
      // The delivery claim: waiting run + this handoff still undelivered (EXISTS sub-select), in one statement.
      createQueryBuilder: jest.fn(() => {
        const params: Record<string, any> = {};
        let patch: Record<string, any> = {};
        const qb: any = {
          update: () => qb,
          set: (values: Record<string, any>) => ((patch = values), qb),
          where: (_sql: string, values: Record<string, any>) => (Object.assign(params, values), qb),
          andWhere: (_sql: string, values?: Record<string, any>) => (Object.assign(params, values ?? {}), qb),
          execute: async () => {
            const handoffRow = handoffs.rows.find(
              (row) =>
                row.id === params['handoffId'] &&
                row.sourceTaskRunId === params['runId'] &&
                !row.deliveredAt &&
                !row.deliveryFailureMessage,
            );
            const runRow = runTable.rows.find((row) => row.id === params['runId'] && row.status === 'awaiting_handoff');

            if (!handoffRow || !runRow) {
              return { affected: 0 };
            }

            Object.assign(runRow, patch);

            return { affected: 1 };
          },
        };

        return qb;
      }),
      create: jest.fn((row: Partial<AgentTaskRunEntity>) => row),
      save: jest.fn(async (row: Partial<AgentTaskRunEntity>) => {
        const saved = { id: 'run-1', ...row } as AgentTaskRunEntity;

        runTable.rows.push(saved);

        return { ...saved };
      }),
    });
    handoffs = table<AgentHandoffEntity>([]);
    remoteChat = { sendChatStreaming: jest.fn().mockResolvedValue({ text: 'All good.' }) };
    tasks = { emitTaskUpsert: jest.fn() };
    chatSync = { emitLiveRunUpdate: jest.fn() };
    queue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue(undefined) };
    runner = new AgentTaskRunnerService(
      taskRepo as unknown as Repository<AgentTaskEntity>,
      runs as unknown as Repository<AgentTaskRunEntity>,
      handoffs as unknown as Repository<AgentHandoffEntity>,
      remoteChat as unknown as RemoteAgentsSessionService,
      tasks as unknown as AgentTasksService,
      chatSync as unknown as AgentTaskChatSyncService,
      queue as unknown as Queue,
    );
  });

  describe('claimDueOccurrences', () => {
    it('locks due tasks, enqueues the occurrence and advances next_run_at', async () => {
      const enqueue = jest.fn().mockResolvedValue(undefined);

      await expect(runner.claimDueOccurrences(10, enqueue, now)).resolves.toBe(1);

      expect(queryBuilder['andWhere']).toHaveBeenCalledWith('t.approved_at IS NOT NULL');

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
    it('never runs a task whose approval was revoked after the occurrence was queued', async () => {
      taskRepo.findOne.mockResolvedValue({ ...task, approvedAt: null });

      await runner.executeOccurrence({ taskId, scheduledFor: now.toISOString(), trigger: 'manual' });

      expect(runs.save).not.toHaveBeenCalled();
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    const occurrence = { taskId, scheduledFor: '2026-10-21T09:00:00.000Z', trigger: 'schedule' as const };

    it('runs the task in its unattended session and stores the result', async () => {
      await runner.executeOccurrence(occurrence);

      expect(runs.create).toHaveBeenCalledWith(
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
      expect(runs.rows[0]).toEqual(
        expect.objectContaining({ status: 'succeeded', outputExcerpt: 'All good.', finishedAt: expect.any(Date) }),
      );
      expect(taskRepo.update).toHaveBeenLastCalledWith({ id: taskId }, { lastRunStatus: 'succeeded' });
      expect(chatSync.emitLiveRunUpdate).toHaveBeenCalledTimes(2);
    });

    it('streams the turn unattended and stores its chat events as transcript', async () => {
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

      const saved = runs.rows[0];

      expect(saved.outputExcerpt).toBe('Done.');
      expect(saved.transcript?.map((entry) => (entry.payload as { data: { kind: string } }).data.kind)).toEqual([
        'thinking',
        'assistantMessage',
      ]);
    });

    it('keeps the transcript of failed runs', async () => {
      remoteChat.sendChatStreaming.mockImplementation(
        async (params: { onEvent: (event: unknown) => Promise<void> }) => {
          await params.onEvent(event('toolCall', { name: 'bash' }));

          throw new Error('Remote chat failed');
        },
      );

      await runner.executeOccurrence(occurrence);

      expect(runs.rows[0]).toEqual(
        expect.objectContaining({
          status: 'failed',
          transcript: [expect.objectContaining({ timestamp: expect.any(Number) })],
        }),
      );
    });

    it('records agent failures on the run', async () => {
      remoteChat.sendChatStreaming.mockRejectedValue(new Error('Timed out waiting for agent chat response'));

      await runner.executeOccurrence(occurrence);

      expect(runs.rows[0]).toEqual(
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

    it('skips while a previous run is still in progress or waits for a handoff response', async () => {
      for (const status of ['running', 'awaiting_handoff'] as const) {
        runs.rows.splice(0, runs.rows.length, run({ id: 'run-0', status }));

        await runner.executeOccurrence(occurrence);
      }

      expect(runs.save).not.toHaveBeenCalled();
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    it('ignores re-delivered occurrences (unique run row)', async () => {
      runs.save.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], Object.assign(new Error('duplicate'), { code: '23505' })),
      );

      await runner.executeOccurrence(occurrence);

      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    it('ignores deleted tasks', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await runner.executeOccurrence(occurrence);

      expect(runs.save).not.toHaveBeenCalled();
    });

    it('waits for open handoffs instead of finishing, and delivers responses that arrived during the turn', async () => {
      remoteChat.sendChatStreaming.mockImplementation(async () => {
        // The run handed off during its turn; the target answered before the turn ended.
        handoffs.rows.push(handoff({ status: 'completed' }));

        return { text: 'Asked the reviewer, waiting.' };
      });

      await runner.executeOccurrence(occurrence);

      expect(runs.rows[0]).toEqual(
        expect.objectContaining({
          status: 'awaiting_handoff',
          awaitingHandoffSince: expect.any(Date),
          outputExcerpt: 'Asked the reviewer, waiting.',
        }),
      );
      expect(runs.rows[0].finishedAt).toBeUndefined();
      expect(taskRepo.update).toHaveBeenLastCalledWith({ id: taskId }, { lastRunStatus: 'awaiting_handoff' });
      // Separate delivery jobId: the handoff's own unit may still be in flight.
      expect(queue.add).toHaveBeenCalledWith(
        'agent-handoff.unit',
        { handoffId: 'handoff-1' },
        expect.objectContaining({ jobId: expect.stringContaining('delivery') }),
      );
    });

    it('waits without enqueueing while the target is still working', async () => {
      remoteChat.sendChatStreaming.mockImplementation(async () => {
        handoffs.rows.push(handoff({ status: 'running' }));

        return { text: 'Waiting.' };
      });

      await runner.executeOccurrence(occurrence);

      expect(runs.rows[0].status).toBe('awaiting_handoff');
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('continueWithHandoffResponse', () => {
    const correlationId = 'agent-handoff:handoff-1:response';

    beforeEach(() => {
      runs.rows.push(
        run({
          status: 'awaiting_handoff',
          awaitingHandoffSince: new Date('2026-10-21T09:05:00.000Z'),
          transcript: [{ payload: event('assistantMessage', { text: 'Asked the reviewer.' }), timestamp: 1 }],
        }),
      );
      handoffs.rows.push(handoff({ status: 'completed' }));
    });

    it('continues the waiting run in its own hidden session and finishes it after the reaction', async () => {
      const onAccepted = jest.fn(async () => {
        handoffs.rows[0].deliveredAt = new Date();
      });

      remoteChat.sendChatStreaming.mockImplementation(
        async (params: { onEvent: (event: unknown) => Promise<void> }) => {
          await params.onEvent(event('userMessage', { text: 'RESPONSE' }, correlationId));
          await params.onEvent(event('assistantMessage', { text: 'Used the review.' }));

          return { text: 'Used the review.' };
        },
      );

      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, onAccepted),
      ).resolves.toBe('delivered');

      expect(remoteChat.sendChatStreaming).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId,
          resumeSessionSuffix: `-task-${taskId}`,
          unattendedAutomation: true,
          ephemeral: true,
          model: 'openai/gpt-5',
          message: 'RESPONSE',
          correlationId,
        }),
      );
      expect(remoteChat.sendChatStreaming.mock.calls[0][0]).not.toHaveProperty('chatId');
      expect(onAccepted).toHaveBeenCalledTimes(1);
      // The reaction is part of the run transcript, after the first turn.
      expect(runs.rows[0]).toEqual(
        expect.objectContaining({ status: 'succeeded', outputExcerpt: 'Used the review.', awaitingHandoffSince: null }),
      );
      expect(runs.rows[0].transcript?.map((entry) => (entry.payload as { data: { kind: string } }).data.kind)).toEqual([
        'assistantMessage',
        'userMessage',
        'assistantMessage',
      ]);
    });

    it('leaves the response to the run while its own turn is still working', async () => {
      runs.rows[0].status = 'running';

      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('busy');
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    it('reports runs that ended, are gone or belong to someone else', async () => {
      runs.rows[0].status = 'succeeded';
      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('ended');

      runs.rows[0].status = 'awaiting_handoff';
      await expect(
        runner.continueWithHandoffResponse(
          { ...handoffs.rows[0], sourceAgentId: '00000000-0000-4000-8000-000000000099' },
          'RESPONSE',
          correlationId,
          jest.fn(),
        ),
      ).resolves.toBe('ended');
      await expect(
        runner.continueWithHandoffResponse(
          { ...handoffs.rows[0], sourceTaskRunId: 'run-gone' },
          'RESPONSE',
          correlationId,
          jest.fn(),
        ),
      ).resolves.toBe('ended');
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
    });

    it('waits again (same deadline) when the response never reached the agent', async () => {
      remoteChat.sendChatStreaming.mockRejectedValue(new Error('agent offline'));

      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).rejects.toThrow('agent offline');
      expect(runs.rows[0]).toEqual(
        expect.objectContaining({
          status: 'awaiting_handoff',
          awaitingHandoffSince: new Date('2026-10-21T09:05:00.000Z'),
        }),
      );
    });

    it('ends the run failed when the reaction turn fails after the response was accepted', async () => {
      remoteChat.sendChatStreaming.mockImplementation(
        async (params: { onEvent: (event: unknown) => Promise<void> }) => {
          await params.onEvent(event('userMessage', { text: 'RESPONSE' }, correlationId));

          throw new Error('Timed out');
        },
      );

      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('delivered');
      expect(runs.rows[0]).toEqual(expect.objectContaining({ status: 'failed', failureMessage: 'Timed out' }));
    });

    it('does not deliver when the approval or the approved targets changed while the run waited', async () => {
      task.allowedHandoffAgentIds = [];
      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('revoked');

      task.allowedHandoffAgentIds = ['agent-b'];
      task.approvedAt = null;
      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('revoked');
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
      expect(runs.rows[0].status).toBe('awaiting_handoff');
    });

    it('never delivers a response again once another unit delivered it (run waits for a newer handoff)', async () => {
      handoffs.rows[0].deliveredAt = new Date();
      handoffs.rows.push(handoff({ id: 'handoff-2', status: 'running' }));

      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('busy');
      expect(remoteChat.sendChatStreaming).not.toHaveBeenCalled();
      expect(runs.rows[0].status).toBe('awaiting_handoff');
    });

    it('never delivers twice when two units race for the same waiting run', async () => {
      let release: () => void = () => undefined;

      remoteChat.sendChatStreaming.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ text: 'Done.' });
          }),
      );

      const first = runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn());

      await new Promise((resolve) => setImmediate(resolve));
      await expect(
        runner.continueWithHandoffResponse(handoffs.rows[0], 'RESPONSE', correlationId, jest.fn()),
      ).resolves.toBe('busy');

      release();
      await expect(first).resolves.toBe('delivered');
      expect(remoteChat.sendChatStreaming).toHaveBeenCalledTimes(1);
    });
  });

  it('closes open handoffs of a run that ended, and ends runs whose only handoff became undeliverable', async () => {
    runs.rows.push(run({ status: 'awaiting_handoff', awaitingHandoffSince: new Date() }));
    handoffs.rows.push(handoff({ status: 'completed' }));

    await runner.onHandoffUndeliverable(handoffs.rows[0], 'still open');
    // Still open (not marked undeliverable yet): the run keeps waiting.
    expect(runs.rows[0].status).toBe('awaiting_handoff');

    handoffs.rows[0].deliveryFailureMessage = 'The response could not be delivered after 10 attempts: offline';
    await runner.onHandoffUndeliverable(handoffs.rows[0], 'offline');

    expect(runs.rows[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        failureMessage: expect.stringContaining('"Ask the reviewer" could not be delivered: offline'),
      }),
    );
  });

  it('marks still-open handoffs undeliverable when their run ends', async () => {
    runs.rows.push(run({ status: 'running', startedAt: new Date('2026-10-20T00:00:00.000Z') }));
    handoffs.rows.push(handoff({ status: 'running' }), handoff({ id: 'other', sourceTaskRunId: 'run-2' }));

    await runner.failStaleRuns(now);

    expect(handoffs.rows[0].deliveryFailureMessage).toContain('ended before the response arrived');
    expect(handoffs.rows[1].deliveryFailureMessage).toBeNull();
  });

  it('leaves stale-looking runs alone that a delivery claimed in between', async () => {
    const waiting = run({ status: 'awaiting_handoff', awaitingHandoffSince: new Date('2026-10-20T00:00:00.000Z') });

    runs.rows.push(waiting);
    runs.find.mockImplementationOnce(async () => {
      const snapshot = [{ ...waiting }];

      // A delivery unit claims the run right after the stale scan read it.
      Object.assign(waiting, { status: 'running', awaitingHandoffSince: null, turnStartedAt: now });

      return snapshot;
    });

    await runner.failStaleRuns(now);

    expect(runs.rows[0].status).toBe('running');
  });

  it('fails runs that outlived their timeout, per turn, and runs that waited far too long', async () => {
    runs.rows.push(
      run({ id: 'run-old', status: 'running', startedAt: new Date('2026-10-20T00:00:00.000Z') }),
      // Old run, but its current turn (reaction to a response) just started.
      run({
        id: 'run-resumed',
        taskId: 'task-2',
        status: 'running',
        startedAt: new Date('2026-10-20T00:00:00.000Z'),
        turnStartedAt: new Date('2026-10-21T09:00:00.000Z'),
      }),
      run({
        id: 'run-waiting',
        taskId: 'task-3',
        status: 'awaiting_handoff',
        awaitingHandoffSince: new Date('2026-10-20T00:00:00.000Z'),
      }),
      run({
        id: 'run-waiting-recent',
        taskId: 'task-4',
        status: 'awaiting_handoff',
        awaitingHandoffSince: new Date('2026-10-21T08:30:00.000Z'),
      }),
    );

    await expect(runner.failStaleRuns(now)).resolves.toBe(2);
    expect(runs.rows.map((row) => [row.id, row.status])).toEqual([
      ['run-old', 'failed'],
      ['run-resumed', 'running'],
      ['run-waiting', 'failed'],
      ['run-waiting-recent', 'awaiting_handoff'],
    ]);
    expect(runs.rows[2].failureMessage).toContain('waited too long');
    expect(taskRepo.update).toHaveBeenCalledWith({ id: taskId }, { lastRunStatus: 'failed' });
  });
});
