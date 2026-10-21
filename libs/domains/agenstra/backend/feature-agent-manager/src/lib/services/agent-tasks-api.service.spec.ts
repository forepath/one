import { BadRequestException, HttpException, ServiceUnavailableException } from '@nestjs/common';

import { AgentTasksApiService } from './agent-tasks-api.service';

describe('AgentTasksApiService', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const task = { id: 'task-1', agentId, title: 'Report' };
  let service: AgentTasksApiService;
  let requestControllerTasks: jest.Mock;

  beforeEach(() => {
    service = new AgentTasksApiService();
    requestControllerTasks = jest.fn().mockResolvedValue({ ok: true, task, tasks: [task], runs: [] });
    service.registerBridge({ requestControllerTasks });
  });

  it('is unavailable without a gateway bridge', async () => {
    await expect(new AgentTasksApiService().list(agentId)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('binds every request to the authenticated agent', async () => {
    await service.list(agentId);
    await service.get(agentId, 'task-1');
    await service.update(agentId, 'task-1', { enabled: false });
    await service.delete(agentId, 'task-1');

    expect(requestControllerTasks.mock.calls.map(([id, request]) => [id, request])).toEqual([
      [agentId, { op: 'list', agentId }],
      [agentId, { op: 'get', agentId, taskId: 'task-1' }],
      [agentId, { op: 'update', agentId, taskId: 'task-1', input: { enabled: false } }],
      [agentId, { op: 'delete', agentId, taskId: 'task-1' }],
    ]);
  });

  it('defaults the model of created tasks to the last chat model and requires one', async () => {
    const input = { title: 't', prompt: 'p', cronExpression: '0 9 * * *' };

    await expect(service.create(agentId, input)).rejects.toBeInstanceOf(BadRequestException);

    service.rememberChatModel(agentId, '  anthropic/claude-opus-5-5 ');
    service.rememberChatModel(agentId, undefined);
    await service.create(agentId, input);
    await service.create(agentId, { ...input, model: 'openai/gpt-5' });

    expect(requestControllerTasks.mock.calls[0][1]).toEqual({
      op: 'create',
      agentId,
      input: { ...input, model: 'anthropic/claude-opus-5-5' },
    });
    expect(requestControllerTasks.mock.calls[1][1].input.model).toBe('openai/gpt-5');
  });

  it('maps controller errors to HTTP errors with their status', async () => {
    requestControllerTasks.mockResolvedValue({ ok: false, error: 'Task not found', status: 404 });

    await expect(service.get(agentId, 'task-1')).rejects.toMatchObject({ message: 'Task not found', status: 404 });

    requestControllerTasks.mockResolvedValue({ ok: false, error: 'boom' });

    await expect(service.list(agentId)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects malformed success responses', async () => {
    requestControllerTasks.mockResolvedValue({ ok: true });

    await expect(service.get(agentId, 'task-1')).rejects.toBeInstanceOf(HttpException);
  });

  it('reports whether a run was queued', async () => {
    requestControllerTasks.mockResolvedValueOnce({ ok: true, queued: true });
    requestControllerTasks.mockResolvedValueOnce({ ok: true, queued: false });

    await expect(service.run(agentId, 'task-1')).resolves.toEqual({ taskId: 'task-1', queued: true });
    await expect(service.run(agentId, 'task-1')).resolves.toEqual(
      expect.objectContaining({ taskId: 'task-1', queued: false, message: expect.any(String) }),
    );
  });
});
