import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AgentMessagesService } from '../services/agent-messages.service';

import { AgentsMessagesController } from './agents-messages.controller';

describe('AgentsMessagesController', () => {
  let controller: AgentsMessagesController;
  const agentMessagesService = {
    getLatestAgentMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsMessagesController],
      providers: [{ provide: AgentMessagesService, useValue: agentMessagesService }],
    }).compile();

    controller = module.get(AgentsMessagesController);
    jest.clearAllMocks();
  });

  it('returns latest agent message', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    agentMessagesService.getLatestAgentMessage.mockResolvedValue({
      id: 'msg-1',
      createdAt,
    });

    const result = await controller.getLatestAgentMessage('00000000-0000-4000-8000-000000000001');

    expect(result).toEqual({ id: 'msg-1', createdAt: createdAt.toISOString() });
  });

  it('throws when no agent messages exist', async () => {
    agentMessagesService.getLatestAgentMessage.mockResolvedValue(null);

    await expect(controller.getLatestAgentMessage('00000000-0000-4000-8000-000000000001')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
