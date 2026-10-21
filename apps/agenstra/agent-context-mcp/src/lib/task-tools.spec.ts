import type { AgentTaskSummary } from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import { CONTEXT_TOOL_DEFINITIONS } from './context-tools';
import { callTaskTool, isTaskToolName, TASK_TOOL_DEFINITIONS } from './task-tools';

const TASK: AgentTaskSummary = {
  id: 'task-1',
  agentId: 'agent-1',
  title: 'Daily report',
  prompt: 'Summarize yesterday',
  cronExpression: '0 9 * * *',
  timezone: 'UTC',
  model: 'openai/gpt-5',
  enabled: true,
  nextRunAt: '2026-10-22T09:00:00.000Z',
  lastRunAt: null,
  lastRunStatus: null,
  createdBy: 'agent',
  updatedBy: 'agent',
  createdAt: '2026-10-21T09:00:00.000Z',
  updatedAt: '2026-10-21T09:00:00.000Z',
};

describe('task tools', () => {
  let client: jest.Mocked<
    Pick<ContextApiClient, 'listTasks' | 'getTask' | 'createTask' | 'updateTask' | 'deleteTask' | 'runTask'>
  >;

  beforeEach(() => {
    client = {
      listTasks: jest.fn(),
      getTask: jest.fn(),
      createTask: jest.fn(),
      updateTask: jest.fn(),
      deleteTask: jest.fn(),
      runTask: jest.fn(),
    };
  });

  const call = (name: string, args: unknown) => callTaskTool(client as unknown as ContextApiClient, name, args);

  it('exposes six task tools that do not collide with the context tools', () => {
    expect(TASK_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'tasks_list',
      'tasks_get',
      'tasks_create',
      'tasks_update',
      'tasks_delete',
      'tasks_run',
    ]);

    const contextNames = new Set(CONTEXT_TOOL_DEFINITIONS.map((tool) => tool.name));

    for (const tool of TASK_TOOL_DEFINITIONS) {
      expect(contextNames.has(tool.name)).toBe(false);
      expect(isTaskToolName(tool.name)).toBe(true);
    }

    expect(isTaskToolName('context_list')).toBe(false);
  });

  it('lists tasks as JSON', async () => {
    client.listTasks.mockResolvedValue({ tasks: [TASK] });

    const result = await call('tasks_list', {});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ tasks: [TASK] });
  });

  it('requires a taskId for task-specific tools', async () => {
    for (const name of ['tasks_get', 'tasks_update', 'tasks_delete', 'tasks_run']) {
      const result = await call(name, { title: 'x' });

      expect(result.isError).toBe(true);
    }

    expect(client.getTask).not.toHaveBeenCalled();
    expect(client.updateTask).not.toHaveBeenCalled();
    expect(client.deleteTask).not.toHaveBeenCalled();
    expect(client.runTask).not.toHaveBeenCalled();
  });

  it('creates a task from typed fields only', async () => {
    client.createTask.mockResolvedValue(TASK);

    await call('tasks_create', {
      title: 'Daily report',
      prompt: 'Summarize yesterday',
      cronExpression: '0 9 * * *',
      timezone: 'Europe/Berlin',
      enabled: 'yes',
      agentId: 'someone-else',
    });

    expect(client.createTask).toHaveBeenCalledWith({
      title: 'Daily report',
      prompt: 'Summarize yesterday',
      cronExpression: '0 9 * * *',
      timezone: 'Europe/Berlin',
    });
  });

  it('rejects creation without the required fields', async () => {
    const result = await call('tasks_create', { title: 'Only a title' });

    expect(result.isError).toBe(true);
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('updates only the provided fields and refuses empty patches', async () => {
    client.updateTask.mockResolvedValue({ ...TASK, enabled: false });

    await call('tasks_update', { taskId: ' task-1 ', enabled: false });

    expect(client.updateTask).toHaveBeenCalledWith('task-1', { enabled: false });

    const empty = await call('tasks_update', { taskId: 'task-1' });

    expect(empty.isError).toBe(true);
  });

  it('deletes and runs tasks', async () => {
    client.deleteTask.mockResolvedValue(undefined);
    client.runTask.mockResolvedValue({ taskId: 'task-1', queued: true });

    expect((await call('tasks_delete', { taskId: 'task-1' })).content[0].text).toContain('Deleted task task-1');
    expect(JSON.parse((await call('tasks_run', { taskId: 'task-1' })).content[0].text)).toEqual({
      taskId: 'task-1',
      queued: true,
    });
  });

  it('turns API errors into tool errors', async () => {
    client.getTask.mockRejectedValue(new ContextApiError('Task not found', 404));

    const result = await call('tasks_get', { taskId: 'nope' });

    expect(result).toEqual({ content: [{ type: 'text', text: 'Task not found' }], isError: true });
  });
});
