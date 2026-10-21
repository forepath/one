import { ensureClientAccess } from '@forepath/identity/backend';
import type { ClientAgentCredentialsRepository, ClientUsersRepository } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';

import { AGENT_TASK_UNIT_JOB_NAME } from '../constants/agent-tasks.constants';
import type { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import type { AgentTaskEntity } from '../entities/agent-task.entity';
import type { ClientsRepository } from '../repositories/clients.repository';

import type { AgentTaskRealtimeService } from './agent-task-realtime.service';
import { AgentTasksService } from './agent-tasks.service';

jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return {
    ...actual,
    ensureClientAccess: jest.fn().mockResolvedValue({ isClientCreator: false }),
    getUserFromRequest: jest.fn().mockReturnValue({ userId: 'user-1', isApiKeyAuth: false }),
  };
});

describe('AgentTasksService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const taskId = '00000000-0000-4000-8000-000000000030';
  const input = { title: ' Daily report ', prompt: 'Summarize', cronExpression: '0 9 * * *', model: 'openai/gpt-5' };
  let taskRepo: {
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let runRepo: { count: jest.Mock; find: jest.Mock };
  let credentials: { findByClientAndAgent: jest.Mock };
  let realtime: { emitTaskUpsert: jest.Mock; emitTaskRemoved: jest.Mock };
  let queue: { getJob: jest.Mock; add: jest.Mock };
  let service: AgentTasksService;

  const existingTask = (overrides: Partial<AgentTaskEntity> = {}): AgentTaskEntity =>
    ({
      id: taskId,
      clientId,
      agentId,
      title: 'Daily report',
      prompt: 'Summarize',
      cronExpression: '0 9 * * *',
      timezone: 'UTC',
      model: 'openai/gpt-5',
      enabled: true,
      nextRunAt: new Date('2026-10-22T09:00:00.000Z'),
      lastRunAt: null,
      lastRunStatus: null,
      createdByType: 'user',
      createdByUserId: 'user-1',
      updatedByType: 'user',
      createdAt: new Date('2026-10-21T08:00:00.000Z'),
      updatedAt: new Date('2026-10-21T08:00:00.000Z'),
      ...overrides,
    }) as AgentTaskEntity;

  const build = (withQueue = true) =>
    new AgentTasksService(
      taskRepo as unknown as Repository<AgentTaskEntity>,
      runRepo as unknown as Repository<AgentTaskRunEntity>,
      {} as ClientsRepository,
      {} as ClientUsersRepository,
      credentials as unknown as ClientAgentCredentialsRepository,
      realtime as unknown as AgentTaskRealtimeService,
      withQueue ? (queue as unknown as Queue) : undefined,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    taskRepo = {
      create: jest.fn((row: Partial<AgentTaskEntity>) => row),
      save: jest.fn(async (row: Partial<AgentTaskEntity>) => ({
        id: taskId,
        createdAt: new Date('2026-10-21T08:00:00.000Z'),
        updatedAt: new Date('2026-10-21T08:00:00.000Z'),
        ...row,
      })),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    runRepo = { count: jest.fn().mockResolvedValue(0), find: jest.fn().mockResolvedValue([]) };
    credentials = { findByClientAndAgent: jest.fn().mockResolvedValue({ id: 'cred' }) };
    realtime = { emitTaskUpsert: jest.fn(), emitTaskRemoved: jest.fn() };
    queue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue(undefined) };
    service = build();
  });

  describe('create', () => {
    it('checks workspace access, schedules the next run and publishes the row', async () => {
      const task = await service.create(clientId, agentId, input, {} as never);

      expect(ensureClientAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), clientId, {});
      expect(credentials.findByClientAndAgent).toHaveBeenCalledWith(clientId, agentId);
      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId,
          agentId,
          title: 'Daily report',
          cronExpression: '0 9 * * *',
          timezone: 'UTC',
          enabled: true,
          nextRunAt: expect.any(Date),
          createdByType: 'user',
          createdByUserId: 'user-1',
          updatedByType: 'user',
        }),
      );
      expect(task).toEqual(expect.objectContaining({ id: taskId, clientId, agentId, createdBy: 'user' }));
      expect(realtime.emitTaskUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: taskId }));
    });

    it('does not schedule disabled tasks', async () => {
      await service.create(clientId, agentId, { ...input, enabled: false }, {} as never);

      expect(taskRepo.create).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, nextRunAt: null }));
    });

    it('rejects agents that do not belong to the workspace', async () => {
      credentials.findByClientAndAgent.mockResolvedValue(null);

      await expect(service.create(clientId, agentId, input, {} as never)).rejects.toBeInstanceOf(NotFoundException);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('limits the number of tasks per agent', async () => {
      taskRepo.count.mockResolvedValue(25);

      await expect(service.create(clientId, agentId, input, {} as never)).rejects.toBeInstanceOf(ConflictException);
    });

    it('validates schedule and model', async () => {
      await expect(
        service.create(clientId, agentId, { ...input, cronExpression: '* * * * *' }, {} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(clientId, agentId, { ...input, model: 'no-slash' }, {} as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('records agent-created tasks without a workspace user check', async () => {
      await service.createForAgent(clientId, agentId, input);

      expect(ensureClientAccess).not.toHaveBeenCalled();
      expect(taskRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdByType: 'agent', createdByUserId: null, updatedByType: 'agent' }),
      );
    });

    it('requires a model for agent-created tasks', async () => {
      await expect(service.createForAgent(clientId, agentId, { ...input, model: undefined })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('update', () => {
    it('only finds tasks of the given workspace and agent', async () => {
      await expect(service.updateForAgent(clientId, agentId, taskId, { enabled: false })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(taskRepo.findOne).toHaveBeenCalledWith({ where: { id: taskId, clientId, agentId } });
    });

    it('clears the next run when disabled and recomputes it when re-enabled', async () => {
      taskRepo.findOne.mockResolvedValue(existingTask());

      const disabled = await service.updateForAgent(clientId, agentId, taskId, { enabled: false });

      expect(disabled.nextRunAt).toBeNull();
      expect(disabled.updatedBy).toBe('agent');

      taskRepo.findOne.mockResolvedValue(existingTask({ enabled: false, nextRunAt: null }));

      const enabled = await service.update(clientId, agentId, taskId, { enabled: true }, {} as never);

      expect(enabled.nextRunAt).not.toBeNull();
      expect(enabled.updatedBy).toBe('user');
    });

    it('recomputes the next run when the schedule changes', async () => {
      taskRepo.findOne.mockResolvedValue(existingTask());

      const updated = await service.update(
        clientId,
        agentId,
        taskId,
        { cronExpression: '30 7 * * 1', timezone: 'Europe/Berlin' },
        {} as never,
      );

      expect(updated.cronExpression).toBe('30 7 * * 1');
      expect(updated.timezone).toBe('Europe/Berlin');
      expect(updated.nextRunAt).not.toBe('2026-10-22T09:00:00.000Z');
    });
  });

  it('removes tasks and publishes the removal', async () => {
    taskRepo.findOne.mockResolvedValue(existingTask());

    await service.removeForAgent(clientId, agentId, taskId);

    expect(taskRepo.delete).toHaveBeenCalledWith({ id: taskId });
    expect(realtime.emitTaskRemoved).toHaveBeenCalledWith({ clientId, agentId, taskId });
  });

  describe('runNow', () => {
    it('enqueues a manual occurrence', async () => {
      taskRepo.findOne.mockResolvedValue(existingTask());

      await expect(service.runNow(clientId, agentId, taskId, {} as never)).resolves.toEqual({ taskId, queued: true });
      expect(queue.add).toHaveBeenCalledWith(
        AGENT_TASK_UNIT_JOB_NAME,
        expect.objectContaining({ taskId, trigger: 'manual', scheduledFor: expect.any(String) }),
        expect.objectContaining({ jobId: expect.stringMatching(/^agent-task\./) }),
      );
    });

    it('does not queue a second run while one is in progress', async () => {
      taskRepo.findOne.mockResolvedValue(existingTask());
      runRepo.count.mockResolvedValue(1);

      await expect(service.runNowForAgent(clientId, agentId, taskId)).resolves.toEqual({ taskId, queued: false });
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('is unavailable without a queue', async () => {
      taskRepo.findOne.mockResolvedValue(existingTask());

      await expect(build(false).runNowForAgent(clientId, agentId, taskId)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  it('loads transcripts only when the session history is requested', async () => {
    taskRepo.findOne.mockResolvedValue(existingTask());
    runRepo.find.mockResolvedValue([
      {
        id: 'run-1',
        taskId,
        clientId,
        agentId,
        trigger: 'schedule',
        status: 'succeeded',
        scheduledFor: new Date('2026-10-21T09:00:00.000Z'),
        startedAt: new Date('2026-10-21T09:00:01.000Z'),
        finishedAt: null,
        transcript: [{ payload: { kind: 'assistantMessage' }, timestamp: 1 }],
      },
    ]);

    const plain = await service.listRuns(clientId, agentId, taskId, {}, {} as never);

    expect(runRepo.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ select: expect.not.arrayContaining(['transcript']) }),
    );
    expect(plain[0].transcript).toBeUndefined();

    const withTranscript = await service.listRuns(
      clientId,
      agentId,
      taskId,
      { limit: 5, offset: 10, includeTranscript: true },
      {} as never,
    );

    expect(runRepo.find).toHaveBeenLastCalledWith(expect.not.objectContaining({ select: expect.anything() }));
    expect(withTranscript[0].transcript).toEqual([{ payload: { kind: 'assistantMessage' }, timestamp: 1 }]);
    expect(runRepo.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 5, skip: 10, order: { startedAt: 'DESC', id: 'DESC' } }),
    );
  });

  it('returns task details with recent runs', async () => {
    taskRepo.findOne.mockResolvedValue(existingTask());
    runRepo.find.mockResolvedValue([
      {
        id: 'run-1',
        taskId,
        clientId,
        agentId,
        trigger: 'schedule',
        status: 'succeeded',
        scheduledFor: new Date('2026-10-21T09:00:00.000Z'),
        startedAt: new Date('2026-10-21T09:00:01.000Z'),
        finishedAt: new Date('2026-10-21T09:01:00.000Z'),
        outputExcerpt: 'Done',
        failureMessage: null,
      },
    ]);

    const detail = await service.getForAgent(clientId, agentId, taskId);

    expect(detail.task.id).toBe(taskId);
    expect(detail.runs).toEqual([expect.objectContaining({ id: 'run-1', status: 'succeeded', outputExcerpt: 'Done' })]);
    expect(runRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { taskId }, take: 10 }));
  });
});
