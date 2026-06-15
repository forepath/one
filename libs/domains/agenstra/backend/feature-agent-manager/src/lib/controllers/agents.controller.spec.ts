import { Test, TestingModule } from '@nestjs/testing';

import { AgentModelsResponseDto } from '../dto/agent-models-response.dto';
import { AgentResponseDto } from '../dto/agent-response.dto';
import { CreateAgentResponseDto } from '../dto/create-agent-response.dto';
import { CreateAgentDto } from '../dto/create-agent.dto';
import { UpdateAgentDto } from '../dto/update-agent.dto';
import { ContainerType } from '../entities/agent.entity';
import { AgentsService } from '../services/agents.service';

import { AgentsController } from './agents.controller';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: jest.Mocked<AgentsService>;
  const mockAgentResponse: AgentResponseDto = {
    id: 'test-uuid',
    name: 'Test Agent',
    description: 'Test Description',
    agentType: 'cursor',
    containerType: ContainerType.GENERIC,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockCreateAgentResponse: CreateAgentResponseDto = {
    ...mockAgentResponse,
    password: 'generated-password-123',
  };
  const mockService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    restart: jest.fn(),
    listModels: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get(AgentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAgents', () => {
    it('should return array of agents', async () => {
      const agents = [mockAgentResponse];

      service.findAll.mockResolvedValue(agents);

      const result = await controller.getAgents(10, 0);

      expect(result).toEqual(agents);
      expect(service.findAll).toHaveBeenCalledWith(10, 0);
    });

    it('should use default pagination values', async () => {
      const agents = [mockAgentResponse];

      service.findAll.mockResolvedValue(agents);

      const result = await controller.getAgents();

      expect(result).toEqual(agents);
      expect(service.findAll).toHaveBeenCalledWith(10, 0);
    });
  });

  describe('getAgent', () => {
    it('should return single agent', async () => {
      service.findOne.mockResolvedValue(mockAgentResponse);

      const result = await controller.getAgent('test-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(service.findOne).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('listAgentModels', () => {
    it('should return models map from service', async () => {
      const models: AgentModelsResponseDto = { 'model-a': 'Model A', 'model-b': 'Model B' };

      service.listModels.mockResolvedValue(models);

      const result = await controller.listAgentModels('test-uuid');

      expect(result).toEqual(models);
      expect(service.listModels).toHaveBeenCalledWith('test-uuid');
    });

    it('should return empty object when service returns no models', async () => {
      service.listModels.mockResolvedValue({});

      const result = await controller.listAgentModels('test-uuid');

      expect(result).toEqual({});
      expect(service.listModels).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('createAgent', () => {
    it('should create new agent with auto-generated password', async () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Description',
      };

      service.create.mockResolvedValue(mockCreateAgentResponse);

      const result = await controller.createAgent(createDto);

      expect(result).toEqual(mockCreateAgentResponse);
      expect(result.password).toBeDefined();
      expect(service.create).toHaveBeenCalledWith(createDto);
    });
  });

  describe('updateAgent', () => {
    it('should update agent', async () => {
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
      };

      service.update.mockResolvedValue(mockAgentResponse);

      const result = await controller.updateAgent('test-uuid', updateDto);

      expect(result).toEqual(mockAgentResponse);
      expect(service.update).toHaveBeenCalledWith('test-uuid', updateDto);
    });
  });

  describe('deleteAgent', () => {
    it('should delete agent', async () => {
      service.remove.mockResolvedValue(undefined);

      await controller.deleteAgent('test-uuid');

      expect(service.remove).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('startAgent', () => {
    it('should start agent and return agent response', async () => {
      service.start.mockResolvedValue(mockAgentResponse);

      const result = await controller.startAgent('test-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(service.start).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('stopAgent', () => {
    it('should stop agent and return agent response', async () => {
      service.stop.mockResolvedValue(mockAgentResponse);

      const result = await controller.stopAgent('test-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(service.stop).toHaveBeenCalledWith('test-uuid');
    });
  });

  describe('restartAgent', () => {
    it('should restart agent and return agent response', async () => {
      service.restart.mockResolvedValue(mockAgentResponse);

      const result = await controller.restartAgent('test-uuid');

      expect(result).toEqual(mockAgentResponse);
      expect(service.restart).toHaveBeenCalledWith('test-uuid');
    });
  });
});
