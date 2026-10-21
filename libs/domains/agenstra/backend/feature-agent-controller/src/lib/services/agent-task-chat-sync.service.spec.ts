import type { Socket } from 'socket.io';
import type { Repository } from 'typeorm';

import type { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import type { AgentTaskEntity } from '../entities/agent-task.entity';

import type { AgentConsoleStatusService } from './agent-console-status.service';
import { AgentTaskChatSyncService } from './agent-task-chat-sync.service';
import type { AgentTaskRealtimeService } from './agent-task-realtime.service';

describe('AgentTaskChatSyncService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const task = {
    id: 'task-1',
    clientId,
    agentId,
    title: 'Daily report',
    cronExpression: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
  } as AgentTaskEntity;
  const run = (id: string, startedAt: string, extra: Partial<AgentTaskRunEntity> = {}) =>
    ({
      id,
      taskId: 'task-1',
      clientId,
      agentId,
      trigger: 'schedule',
      status: 'succeeded',
      scheduledFor: new Date(startedAt),
      startedAt: new Date(startedAt),
      finishedAt: null,
      updatedAt: new Date(startedAt),
      outputExcerpt: null,
      failureMessage: null,
      ...extra,
    }) as AgentTaskRunEntity;
  let runRepo: { find: jest.Mock };
  let taskRepo: { find: jest.Mock };
  let realtime: { emitRunChatUpsert: jest.Mock; emitRunChatUpsertToSocket: jest.Mock };
  let status: { onAutomationChatActivity: jest.Mock };
  let sync: AgentTaskChatSyncService;

  beforeEach(() => {
    runRepo = { find: jest.fn() };
    taskRepo = { find: jest.fn().mockResolvedValue([task]) };
    realtime = { emitRunChatUpsert: jest.fn(), emitRunChatUpsertToSocket: jest.fn() };
    status = { onAutomationChatActivity: jest.fn().mockResolvedValue(undefined) };
    sync = new AgentTaskChatSyncService(
      runRepo as unknown as Repository<AgentTaskRunEntity>,
      taskRepo as unknown as Repository<AgentTaskEntity>,
      realtime as unknown as AgentTaskRealtimeService,
      status as unknown as AgentConsoleStatusService,
    );
  });

  it('builds a card with an open action and ordering timestamp', () => {
    const live = sync.buildPayload(
      task,
      run('run-1', '2026-10-21T09:00:00.000Z', { finishedAt: new Date('2026-10-21T09:05:00.000Z') }),
      false,
    );

    expect(live).toEqual(
      expect.objectContaining({
        timelineAt: '2026-10-21T09:05:00.000Z',
        hydrate: false,
        task: expect.objectContaining({ id: 'task-1', title: 'Daily report', agentId }),
        run: expect.objectContaining({ id: 'run-1', status: 'succeeded' }),
        actions: [expect.objectContaining({ type: 'openAgentTask', taskId: 'task-1', runId: 'run-1' })],
      }),
    );
    expect(sync.buildPayload(task, run('run-1', '2026-10-21T09:00:00.000Z'), true).timelineAt).toBe(
      '2026-10-21T09:00:00.000Z',
    );
  });

  it('hydrates the newest runs of this agent oldest first', async () => {
    runRepo.find.mockResolvedValue([
      run('run-2', '2026-10-21T09:00:00.000Z'),
      run('run-1', '2026-10-20T09:00:00.000Z'),
    ]);
    const socket = {} as Socket;

    await sync.hydrateForAgentClient(socket, clientId, agentId);

    expect(runRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId, agentId }), order: { startedAt: 'DESC' } }),
    );
    expect(realtime.emitRunChatUpsertToSocket.mock.calls.map(([, payload]) => payload.run.id)).toEqual([
      'run-1',
      'run-2',
    ]);
  });

  it('skips the task lookup when there is nothing to hydrate', async () => {
    runRepo.find.mockResolvedValue([]);

    await sync.hydrateForAgentClient({} as Socket, clientId, agentId);

    expect(taskRepo.find).not.toHaveBeenCalled();
  });

  it('publishes live updates to the workspace room', () => {
    sync.emitLiveRunUpdate(task, run('run-1', '2026-10-21T09:00:00.000Z'));

    expect(realtime.emitRunChatUpsert).toHaveBeenCalledWith(clientId, expect.objectContaining({ hydrate: false }));
    expect(status.onAutomationChatActivity).toHaveBeenCalledWith(clientId, agentId, expect.any(Date));
  });
});
