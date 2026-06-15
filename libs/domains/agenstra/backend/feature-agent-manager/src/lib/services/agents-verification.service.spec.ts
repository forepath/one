import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AgentEntity, ContainerType } from '../entities/agent.entity';
import { AgentsRepository } from '../repositories/agents.repository';

import { AgentsVerificationService } from './agents-verification.service';
import { AgentsService } from './agents.service';
import { DockerService } from './docker.service';

describe('AgentsVerificationService', () => {
  let service: AgentsVerificationService;
  const agentsService = { findOne: jest.fn() };
  const agentsRepository = { findByIdOrThrow: jest.fn() };
  const dockerService = { sendCommandToContainer: jest.fn() };
  const agent: AgentEntity = {
    id: 'a1',
    name: 'A',
    description: '',
    hashedPassword: 'x',
    containerId: 'c1',
    volumePath: '/v',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsVerificationService,
        { provide: AgentsService, useValue: agentsService },
        { provide: AgentsRepository, useValue: agentsRepository },
        { provide: DockerService, useValue: dockerService },
      ],
    }).compile();

    service = module.get(AgentsVerificationService);
  });

  it('returns results with exit codes', async () => {
    agentsService.findOne.mockResolvedValue({});
    agentsRepository.findByIdOrThrow.mockResolvedValue(agent);
    dockerService.sendCommandToContainer.mockResolvedValue('ok\n__EXIT:0\n');

    const res = await service.runVerifierCommands('a1', {
      commands: [{ cmd: 'echo ok' }],
      timeoutMs: 5000,
    });

    expect(res.results).toHaveLength(1);
    expect(res.results[0].exitCode).toBe(0);
  });

  it('rejects commands with shell metacharacters', async () => {
    agentsService.findOne.mockResolvedValue({});
    agentsRepository.findByIdOrThrow.mockResolvedValue(agent);
    await expect(
      service.runVerifierCommands('a1', {
        commands: [{ cmd: 'echo bad; rm -rf /' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
