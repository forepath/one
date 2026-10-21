import { AGENT_TASK_REQUEST_EVENT } from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Socket as ClientSocket } from 'socket.io-client';

import { AgentTaskRequestHandlerService } from './agent-task-request-handler.service';
import type { AgentTasksService } from './agent-tasks.service';

describe('AgentTaskRequestHandlerService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const agentId = '00000000-0000-4000-8000-000000000020';
  const taskId = '00000000-0000-4000-8000-000000000030';
  let tasks: Record<string, jest.Mock>;
  let handler: AgentTaskRequestHandlerService;

  beforeEach(() => {
    tasks = {
      listForAgent: jest.fn().mockResolvedValue([{ id: taskId }]),
      getForAgent: jest.fn().mockResolvedValue({ task: { id: taskId }, runs: [] }),
      createForAgent: jest.fn().mockResolvedValue({ id: taskId }),
      updateForAgent: jest.fn().mockResolvedValue({ id: taskId }),
      removeForAgent: jest.fn().mockResolvedValue(undefined),
      runNowForAgent: jest.fn().mockResolvedValue({ taskId, queued: true }),
    };
    handler = new AgentTaskRequestHandlerService(tasks as unknown as AgentTasksService);
  });

  it('scopes every operation to the connection workspace and the requesting agent', async () => {
    await handler.handle(clientId, { op: 'list', agentId });
    await handler.handle(clientId, { op: 'get', agentId, taskId });
    await handler.handle(clientId, { op: 'delete', agentId: agentId.toUpperCase(), taskId });
    await handler.handle(clientId, { op: 'run', agentId, taskId, clientId: 'other-workspace' });

    expect(tasks['listForAgent']).toHaveBeenCalledWith(clientId, agentId);
    expect(tasks['getForAgent']).toHaveBeenCalledWith(clientId, agentId, taskId);
    expect(tasks['removeForAgent']).toHaveBeenCalledWith(clientId, agentId, taskId);
    expect(tasks['runNowForAgent']).toHaveBeenCalledWith(clientId, agentId, taskId);
  });

  it('passes typed input fields only', async () => {
    await handler.handle(clientId, {
      op: 'create',
      agentId,
      input: { title: 'T', prompt: 'P', cronExpression: '0 9 * * *', enabled: 'no', agentId: 'other', clientId: 'x' },
    });

    expect(tasks['createForAgent']).toHaveBeenCalledWith(clientId, agentId, {
      title: 'T',
      prompt: 'P',
      cronExpression: '0 9 * * *',
    });
  });

  it('shapes results per operation', async () => {
    await expect(handler.handle(clientId, { op: 'list', agentId })).resolves.toEqual({
      ok: true,
      tasks: [{ id: taskId }],
    });
    await expect(handler.handle(clientId, { op: 'get', agentId, taskId })).resolves.toEqual({
      ok: true,
      task: { id: taskId },
      runs: [],
    });
    await expect(handler.handle(clientId, { op: 'delete', agentId, taskId })).resolves.toEqual({
      ok: true,
      deleted: true,
    });
    await expect(handler.handle(clientId, { op: 'run', agentId, taskId })).resolves.toEqual({ ok: true, queued: true });
  });

  it('rejects malformed requests without touching tasks', async () => {
    await expect(handler.handle(clientId, { op: 'list', agentId: 'nope' })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });
    await expect(handler.handle(clientId, { op: 'get', agentId, taskId: '../x' })).resolves.toMatchObject({
      ok: false,
      status: 404,
    });
    await expect(handler.handle(clientId, { op: 'drop', agentId })).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(handler.handle(clientId, null)).resolves.toMatchObject({ ok: false });

    expect(Object.values(tasks).every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  it('maps HTTP errors to status-carrying failures', async () => {
    tasks['getForAgent'].mockRejectedValue(new NotFoundException('Task not found'));
    tasks['updateForAgent'].mockRejectedValue(new BadRequestException(['a', 'b']));
    tasks['listForAgent'].mockRejectedValue(new Error('db down'));

    await expect(handler.handle(clientId, { op: 'get', agentId, taskId })).resolves.toEqual({
      ok: false,
      error: 'Task not found',
      status: 404,
    });
    await expect(handler.handle(clientId, { op: 'update', agentId, taskId, input: {} })).resolves.toEqual({
      ok: false,
      error: 'a; b',
      status: 400,
    });
    await expect(handler.handle(clientId, { op: 'list', agentId })).resolves.toEqual({
      ok: false,
      error: 'Task request failed',
      status: 500,
    });
  });

  it('answers through the socket ack and ignores events without ack', async () => {
    const listeners = new Map<string, (request: unknown, ack?: (response: unknown) => void) => void>();
    const remote = { on: jest.fn((event, listener) => listeners.set(event, listener)) };

    handler.attach(remote as unknown as ClientSocket, clientId);

    const listener = listeners.get(AGENT_TASK_REQUEST_EVENT);
    const ack = jest.fn();

    listener?.({ op: 'list', agentId });
    listener?.({ op: 'list', agentId }, ack);
    await new Promise((resolve) => setImmediate(resolve));

    expect(tasks['listForAgent']).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith({ ok: true, tasks: [{ id: taskId }] });
  });
});
