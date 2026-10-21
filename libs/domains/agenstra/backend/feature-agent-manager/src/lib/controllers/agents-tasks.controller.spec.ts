import { IS_PUBLIC_KEY } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { AgentContextMcpService } from '../services/agent-context-mcp.service';
import { AgentTasksApiService } from '../services/agent-tasks-api.service';

import { AgentsTasksController } from './agents-tasks.controller';

describe('AgentsTasksController', () => {
  const agentId = '11111111-1111-4111-8111-111111111111';
  const taskId = '33333333-3333-4333-8333-333333333333';
  const auth = 'Bearer good-token';
  let contextMcp: { verifyAgentToken: jest.Mock };
  let tasks: {
    list: jest.Mock;
    get: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    run: jest.Mock;
  };
  let controller: AgentsTasksController;

  beforeEach(() => {
    contextMcp = {
      verifyAgentToken: jest.fn(async (id: string, token: string) => id === agentId && token === 'good-token'),
    };
    tasks = {
      list: jest.fn().mockResolvedValue({ tasks: [] }),
      get: jest.fn().mockResolvedValue({ task: {}, runs: [] }),
      create: jest.fn().mockResolvedValue({ id: taskId }),
      update: jest.fn().mockResolvedValue({ id: taskId }),
      delete: jest.fn().mockResolvedValue(undefined),
      run: jest.fn().mockResolvedValue({ taskId, queued: true }),
    };
    controller = new AgentsTasksController(
      contextMcp as unknown as AgentContextMcpService,
      tasks as unknown as AgentTasksApiService,
    );
  });

  it('bypasses user authentication guards (agent token auth instead)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AgentsTasksController)).toBe(true);
    expect(Reflect.getMetadata('public', AgentsTasksController)).toBe(true);
  });

  it('rejects invalid agent credentials before touching tasks', async () => {
    await expect(controller.list(agentId, 'Bearer wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.delete(taskId, 'not-a-uuid', auth)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.create({}, undefined, undefined)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tasks.list).not.toHaveBeenCalled();
    expect(tasks.delete).not.toHaveBeenCalled();
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('delegates with the authenticated agent id', async () => {
    await controller.list(agentId, auth);
    await controller.get(taskId.toUpperCase(), agentId, auth);
    await controller.update(taskId, { enabled: false, agentId: 'ignored' }, agentId, auth);
    await controller.delete(taskId, agentId, auth);
    await controller.run(taskId, agentId, auth);

    expect(tasks.list).toHaveBeenCalledWith(agentId);
    expect(tasks.get).toHaveBeenCalledWith(agentId, taskId);
    expect(tasks.update).toHaveBeenCalledWith(agentId, taskId, { enabled: false });
    expect(tasks.delete).toHaveBeenCalledWith(agentId, taskId);
    expect(tasks.run).toHaveBeenCalledWith(agentId, taskId);
  });

  it('validates create input', async () => {
    await expect(controller.create({ title: 'only title' }, agentId, auth)).rejects.toBeInstanceOf(BadRequestException);

    await controller.create({ title: ' Report ', prompt: 'Do it', cronExpression: '0 9 * * *' }, agentId, auth);

    expect(tasks.create).toHaveBeenCalledWith(agentId, {
      title: 'Report',
      prompt: 'Do it',
      cronExpression: '0 9 * * *',
    });
  });

  it('treats malformed task ids as unknown tasks', async () => {
    await expect(controller.get('../other', agentId, auth)).rejects.toBeInstanceOf(NotFoundException);
    expect(tasks.get).not.toHaveBeenCalled();
  });
});
