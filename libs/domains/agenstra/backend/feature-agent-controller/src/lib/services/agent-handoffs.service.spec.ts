import type { ClientAgentCredentialsRepository } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Repository } from 'typeorm';

import type { AgentHandoffEntity } from '../entities/agent-handoff.entity';

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
  };
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
    };
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
      const summary = await service.createForAgent(clientId, sourceAgentId, sourceChatId, input);

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
        service.createForAgent(clientId, sourceAgentId, sourceChatId, { ...input, targetAgentId: sourceAgentId }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createForAgent(clientId, sourceAgentId, sourceChatId, { ...input, targetAgentId: foreignAgentId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.createForAgent('00000000-0000-4000-8000-0000000000ff', sourceAgentId, sourceChatId, input),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(chatsProxy.create).not.toHaveBeenCalled();
    });

    it('keeps a usable model of the requesting chat for the response turn', async () => {
      await service.createForAgent(clientId, sourceAgentId, sourceChatId, input, 'openai/gpt-5');
      expect(handoffRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceModel: 'openai/gpt-5' }));

      await service.createForAgent(clientId, sourceAgentId, sourceChatId, input, 'not a model');
      expect(handoffRepo.save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceModel: null }));
    });

    it('validates fields and the model', async () => {
      await expect(
        service.createForAgent(clientId, sourceAgentId, sourceChatId, { ...input, message: ' ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createForAgent(clientId, sourceAgentId, sourceChatId, { ...input, model: 'no-slash' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await service.createForAgent(clientId, sourceAgentId, sourceChatId, { ...input, model: 'openai/gpt-5' });
      expect(handoffRepo.save).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-5' }));
    });

    it('bounds open handoffs per workspace and requires the queue', async () => {
      handoffRepo.count.mockResolvedValue(20);

      await expect(service.createForAgent(clientId, sourceAgentId, sourceChatId, input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(build(false).createForAgent(clientId, sourceAgentId, sourceChatId, input)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(chatsProxy.create).not.toHaveBeenCalled();
    });

    it('derives the chain depth from a handoff chat and refuses chains that are too deep', async () => {
      handoffRepo.findOne.mockResolvedValueOnce(handoff({ id: 'parent', depth: 2, targetAgentId: sourceAgentId }));

      await service.createForAgent(clientId, sourceAgentId, sourceChatId, input);

      expect(handoffRepo.findOne).toHaveBeenCalledWith({
        where: { clientId, targetAgentId: sourceAgentId, targetChatId: sourceChatId },
      });
      expect(handoffRepo.save).toHaveBeenCalledWith(expect.objectContaining({ parentHandoffId: 'parent', depth: 3 }));

      handoffRepo.findOne.mockResolvedValueOnce(handoff({ id: 'parent', depth: 3, targetAgentId: sourceAgentId }));

      await expect(service.createForAgent(clientId, sourceAgentId, sourceChatId, input)).rejects.toThrow(
        /cannot be handed over again/,
      );
    });

    it('reports targets that are registered but gone on the manager as missing', async () => {
      agentProxy.getClientAgent.mockImplementation(async (_c: string, agentId: string) => {
        if (agentId === targetAgentId) {
          throw new NotFoundException('Agent with ID x not found');
        }

        return { id: agentId, name: 'Backend' };
      });

      await expect(service.createForAgent(clientId, sourceAgentId, sourceChatId, input)).rejects.toThrow(
        'Target agent not found in this workspace',
      );
      expect(chatsProxy.create).not.toHaveBeenCalled();
    });

    it('keeps the handoff when enqueueing fails (the coordinator retries)', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.createForAgent(clientId, sourceAgentId, sourceChatId, input)).resolves.toEqual(
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
