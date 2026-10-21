import type { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';

import { AgentHandoffEntity } from '../entities/agent-handoff.entity';
import { AgentTaskRunEntity } from '../entities/agent-task-run.entity';
import { AgentTaskEntity } from '../entities/agent-task.entity';

import { AgentHandoffsService } from './agent-handoffs.service';
import type { ClientAgentChatsProxyService } from './client-agent-chats-proxy.service';
import type { ClientAgentProxyService } from './client-agent-proxy.service';

describe('AgentHandoffsService', () => {
  const clientId = '00000000-0000-4000-8000-000000000010';
  const sourceAgentId = '00000000-0000-4000-8000-000000000020';
  const targetAgentId = '00000000-0000-4000-8000-000000000030';
  const foreignAgentId = '00000000-0000-4000-8000-000000000099';
  const handoffId = '00000000-0000-4000-8000-000000000040';
  const targetChatId = '00000000-0000-4000-8000-000000000060';
  const sourceChatId = '00000000-0000-4000-8000-000000000050';
  let handoffRepo: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let taskRepo: { findOne: jest.Mock };
  let runQuery: Record<string, jest.Mock>;
  const chat = (chatId: string) => ({ kind: 'chat' as const, chatId });
  let credentials: { findByClientAndAgent: jest.Mock };
  let agentProxy: { getClientAgents: jest.Mock; getClientAgent: jest.Mock };
  let chatsProxy: { create: jest.Mock };
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let service: AgentHandoffsService;

  const handoff = (overrides: Partial<AgentHandoffEntity> = {}): AgentHandoffEntity =>
    ({
      id: handoffId,
      clientId,
      sourceAgentId,
      sourceAgentName: 'Backend',
      targetAgentId,
      targetAgentName: 'Reviewer',
      targetChatId,
      title: 'Review',
      message: 'Check',
      status: 'running',
      depth: 1,
      sourceChatId: '00000000-0000-4000-8000-000000000050',
      createdAt: new Date('2026-10-21T09:00:00.000Z'),
      ...overrides,
    }) as AgentHandoffEntity;

  const build = (withQueue = true) =>
    new AgentHandoffsService(
      handoffRepo as unknown as Repository<AgentHandoffEntity>,
      credentials as unknown as ClientAgentCredentialsRepository,
      agentProxy as unknown as ClientAgentProxyService,
      chatsProxy as unknown as ClientAgentChatsProxyService,
      withQueue ? (queue as unknown as Queue) : undefined,
    );

  beforeEach(() => {
    handoffRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((row: Partial<AgentHandoffEntity>) => row),
      save: jest.fn(async (row: Partial<AgentHandoffEntity>) => ({
        id: handoffId,
        createdAt: new Date('2026-10-21T09:00:00.000Z'),
        ...row,
      })),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn(async (work: (em: unknown) => Promise<unknown>) =>
          work({
            getRepository: (entity: unknown) =>
              entity === AgentTaskEntity
                ? taskRepo
                : entity === AgentTaskRunEntity
                  ? { createQueryBuilder: () => runQuery }
                  : entity === AgentHandoffEntity
                    ? handoffRepo
                    : undefined,
          }),
        ),
      },
    };
    taskRepo = { findOne: jest.fn().mockResolvedValue(null) };
    runQuery = {};

    for (const method of ['setLock', 'where', 'andWhere']) {
      runQuery[method] = jest.fn(() => runQuery);
    }

    runQuery['getOne'] = jest.fn().mockResolvedValue(null);
    credentials = {
      findByClientAndAgent: jest.fn(async (c: string, agentId: string) =>
        c === clientId && agentId !== foreignAgentId ? { password: 'x' } : null,
      ),
    };
    agentProxy = {
      getClientAgents: jest.fn().mockResolvedValue([
        { id: sourceAgentId, name: 'Backend' },
        {
          id: targetAgentId,
          name: 'Reviewer',
          description: 'Reviews code',
          handoffProfile: 'Owns the review pipeline',
          containerType: 'generic',
          git: { repositoryUrl: 'https://git.example/reviewer.git', setupMode: 'clone' },
          primaryChatId: 'secret-chat',
        },
        { id: foreignAgentId, name: 'Elsewhere' },
      ]),
      getClientAgent: jest.fn(async (_c: string, agentId: string) => ({
        id: agentId,
        name: agentId === sourceAgentId ? 'Backend' : 'Reviewer',
      })),
    };
    chatsProxy = { create: jest.fn().mockResolvedValue({ id: targetChatId, kind: 'handoff' }) };
    queue = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn().mockResolvedValue(undefined) };
    service = build();
  });

  it('lists only other agents of the workspace', async () => {
    await expect(service.listAgentsForAgent(clientId, sourceAgentId)).resolves.toEqual([
      {
        id: targetAgentId,
        name: 'Reviewer',
        description: 'Reviews code',
        handoffProfile: 'Owns the review pipeline',
        containerType: 'generic',
        repositoryUrl: 'https://git.example/reviewer.git',
      },
    ]);
  });

  describe('createForAgent', () => {
    const input = { targetAgentId, title: ' Review ', message: ' Check the API ' };

    it('opens a handoff chat on the target, stores the handoff and queues it', async () => {
      const summary = await service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input);

      expect(chatsProxy.create).toHaveBeenCalledWith(clientId, targetAgentId, { title: 'Review', kind: 'handoff' });
      expect(handoffRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId,
          sourceAgentId,
          sourceAgentName: 'Backend',
          sourceChatId,
          parentHandoffId: null,
          depth: 1,
          targetAgentId,
          targetAgentName: 'Reviewer',
          targetChatId,
          title: 'Review',
          message: 'Check the API',
          status: 'pending',
          model: null,
        }),
      );
      expect(queue.add).toHaveBeenCalledWith(
        'agent-handoff.unit',
        { handoffId },
        expect.objectContaining({ jobId: expect.stringContaining(handoffId) }),
      );
      expect(summary).toEqual(expect.objectContaining({ id: handoffId, targetChatId, status: 'pending' }));
    });

    it('only accepts other agents of the same workspace', async () => {
      await expect(
        service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), { ...input, targetAgentId: sourceAgentId }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), {
          ...input,
          targetAgentId: foreignAgentId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createForAgent('00000000-0000-4000-8000-0000000000ff', sourceAgentId, chat(sourceChatId), input),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(chatsProxy.create).not.toHaveBeenCalled();
    });

    it('keeps a usable model of the requesting chat for the response turn', async () => {
      await service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input, 'openai/gpt-5');
      expect(handoffRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceModel: 'openai/gpt-5' }));

      await service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input, 'not a model');
      expect(handoffRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceModel: null }));
    });

    it('validates fields and the model', async () => {
      await expect(
        service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), { ...input, message: ' ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), { ...input, model: 'no-slash' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), { ...input, model: 'openai/gpt-5' });
      expect(handoffRepo.save).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5' }));
    });

    it('bounds open handoffs per workspace and requires the queue', async () => {
      handoffRepo.count.mockResolvedValue(20);

      await expect(service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        build(false).createForAgent(clientId, sourceAgentId, chat(sourceChatId), input),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(chatsProxy.create).not.toHaveBeenCalled();
    });

    it('derives the chain depth from a handoff chat and refuses chains that are too deep', async () => {
      handoffRepo.findOne.mockResolvedValueOnce(handoff({ id: 'parent', depth: 2, targetAgentId: sourceAgentId }));

      await service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input);

      expect(handoffRepo.findOne).toHaveBeenCalledWith({
        where: { clientId, targetAgentId: sourceAgentId, targetChatId: sourceChatId },
      });
      expect(handoffRepo.save).toHaveBeenCalledWith(expect.objectContaining({ parentHandoffId: 'parent', depth: 3 }));

      handoffRepo.findOne.mockResolvedValueOnce(handoff({ id: 'parent', depth: 3, targetAgentId: sourceAgentId }));

      await expect(service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input)).rejects.toThrow(
        /cannot be handed over again/,
      );
    });

    it('continues the chain when the requester reacts to a delivered response (no endless ping-pong)', async () => {
      handoffRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(handoff({ id: 'answered', depth: 2, sourceAgentId, deliveredAt: new Date() }));

      await service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input);

      expect(handoffRepo.findOne).toHaveBeenNthCalledWith(2, {
        where: expect.objectContaining({
          clientId,
          sourceAgentId,
          sourceChatId,
          deliveredAt: expect.anything(),
          // Only while the turn the response started is still running.
          deliveryTurnEndedAt: expect.anything(),
        }),
        order: { depth: 'DESC', deliveredAt: 'DESC' },
      });
      expect(handoffRepo.save).toHaveBeenCalledWith(expect.objectContaining({ parentHandoffId: 'answered', depth: 3 }));

      handoffRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(handoff({ id: 'answered', depth: 3, sourceAgentId, deliveredAt: new Date() }));

      await expect(service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input)).rejects.toThrow(
        /cannot be handed over again/,
      );
    });

    describe('from a task run', () => {
      const taskId = '00000000-0000-4000-8000-000000000070';
      const runId = '00000000-0000-4000-8000-000000000080';
      const fromRun = { kind: 'taskRun' as const, taskId };
      const approvedTask = (overrides: Partial<AgentTaskEntity> = {}) =>
        ({
          id: taskId,
          clientId,
          agentId: sourceAgentId,
          model: 'openai/gpt-5',
          approvedAt: new Date('2026-10-21T08:00:00.000Z'),
          allowedHandoffAgentIds: [targetAgentId],
          ...overrides,
        }) as AgentTaskEntity;

      beforeEach(() => {
        taskRepo.findOne.mockResolvedValue(approvedTask());
        runQuery['getOne'].mockResolvedValue({ id: runId, taskId, status: 'running' });
      });

      it('hands off to an approved target and binds the response to the locked running run', async () => {
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).resolves.toEqual(
          expect.objectContaining({ sourceChatId: null, sourceTaskId: taskId, sourceTaskRunId: runId }),
        );

        // Task and run are resolved on the server (this agent's task, its running run, row-locked).
        expect(taskRepo.findOne).toHaveBeenCalledWith({ where: { id: taskId, clientId, agentId: sourceAgentId } });
        expect(runQuery['setLock']).toHaveBeenCalledWith('pessimistic_write');
        expect(runQuery['andWhere']).toHaveBeenCalledWith("r.status = 'running'");
        expect(handoffRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceChatId: null,
            sourceTaskId: taskId,
            sourceTaskRunId: runId,
            parentHandoffId: null,
            depth: 1,
            sourceModel: 'openai/gpt-5',
          }),
        );
      });

      it('refuses tasks of other agents, unapproved tasks and runs that are not working', async () => {
        taskRepo.findOne.mockResolvedValueOnce(null);
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toBeInstanceOf(
          BadRequestException,
        );

        taskRepo.findOne.mockResolvedValueOnce(approvedTask({ approvedAt: null }));
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toThrow(
          /waits for approval/,
        );

        runQuery['getOne'].mockResolvedValueOnce(null);
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toThrow(
          /not working anymore/,
        );
        expect(chatsProxy.create).not.toHaveBeenCalled();
      });

      it('only hands off to the approved targets that are still agents of the workspace', async () => {
        taskRepo.findOne.mockResolvedValueOnce(approvedTask({ allowedHandoffAgentIds: [] }));
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toThrow(
          /No agents were approved/,
        );

        const otherPeer = '00000000-0000-4000-8000-000000000031';

        taskRepo.findOne.mockResolvedValueOnce(approvedTask({ allowedHandoffAgentIds: [otherPeer] }));
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toBeInstanceOf(
          ForbiddenException,
        );

        // Approved earlier, moved to another workspace since: does not count.
        taskRepo.findOne.mockResolvedValueOnce(approvedTask({ allowedHandoffAgentIds: [foreignAgentId] }));
        await expect(
          service.createForAgent(clientId, sourceAgentId, fromRun, { ...input, targetAgentId: foreignAgentId }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(chatsProxy.create).not.toHaveBeenCalled();
      });

      it('allows one open handoff per run and a few in total', async () => {
        handoffRepo.findOne.mockResolvedValueOnce(handoff({ sourceTaskRunId: runId, title: 'Earlier' }));
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toThrow(
          /already waits for the response to the handoff "Earlier"/,
        );

        handoffRepo.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
          where['sourceTaskRunId'] === runId ? 3 : 0,
        );
        await expect(service.createForAgent(clientId, sourceAgentId, fromRun, input)).rejects.toThrow(
          /at most 3 times/,
        );
        expect(chatsProxy.create).not.toHaveBeenCalled();
      });

      it('never lets the handoff chat of a task run hand the task on', async () => {
        handoffRepo.findOne.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
          where['targetChatId'] === targetChatId
            ? handoff({ sourceChatId: null, sourceTaskId: taskId, sourceTaskRunId: runId })
            : null,
        );

        await expect(
          service.createForAgent(clientId, targetAgentId, chat(targetChatId), {
            ...input,
            targetAgentId: sourceAgentId,
          }),
        ).rejects.toThrow(/handed over by a scheduled task run of "Backend"; it cannot be handed over again/);
        expect(chatsProxy.create).not.toHaveBeenCalled();
      });
    });

    it('reports targets that are registered but gone on the manager as missing', async () => {
      agentProxy.getClientAgent.mockImplementation(async (_c: string, agentId: string) => {
        if (agentId === targetAgentId) {
          throw new NotFoundException('Agent with ID x not found');
        }

        return { id: agentId, name: 'Backend' };
      });

      await expect(service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input)).rejects.toThrow(
        'Target agent not found in this workspace',
      );
      expect(chatsProxy.create).not.toHaveBeenCalled();
    });

    it('keeps the handoff when enqueueing fails (the coordinator retries)', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.createForAgent(clientId, sourceAgentId, chat(sourceChatId), input)).resolves.toEqual(
        expect.objectContaining({ id: handoffId }),
      );
    });
  });

  it('lets only the source and the target read a handoff, within the workspace', async () => {
    await expect(service.getForAgent(clientId, sourceAgentId, handoffId)).rejects.toBeInstanceOf(NotFoundException);

    expect(handoffRepo.findOne).toHaveBeenCalledWith({
      where: [
        { id: handoffId, clientId, sourceAgentId },
        { id: handoffId, clientId, targetAgentId: sourceAgentId },
      ],
    });

    handoffRepo.findOne.mockResolvedValue(handoff());

    await expect(service.getForAgent(clientId, sourceAgentId, handoffId)).resolves.toEqual(
      expect.objectContaining({ id: handoffId, targetChatId }),
    );
  });

  describe('respondForAgent', () => {
    it('records the target response once', async () => {
      handoffRepo.findOne.mockResolvedValue(handoff());

      const summary = await service.respondForAgent(clientId, targetAgentId, handoffId, {
        status: 'completed',
        response: ' Done ',
      });

      expect(handoffRepo.findOne).toHaveBeenCalledWith({ where: { id: handoffId, clientId, targetAgentId } });
      expect(handoffRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: handoffId }),
        expect.objectContaining({ status: 'completed', response: 'Done' }),
      );
      expect(summary.status).toBe('completed');

      handoffRepo.update.mockResolvedValue({ affected: 0 });

      await expect(
        service.respondForAgent(clientId, targetAgentId, handoffId, { status: 'completed', response: 'again' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('treats responses of other agents as unknown handoffs', async () => {
      await expect(
        service.respondForAgent(clientId, sourceAgentId, handoffId, { status: 'completed', response: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(handoffRepo.update).not.toHaveBeenCalled();
    });
  });
});
