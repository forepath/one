import { Test, TestingModule } from '@nestjs/testing';

import { CreateEnvironmentVariableDto } from '../dto/create-environment-variable.dto';
import { EnvironmentVariableResponseDto } from '../dto/environment-variable-response.dto';
import { UpdateEnvironmentVariableDto } from '../dto/update-environment-variable.dto';
import { AgentEnvironmentVariableEntity } from '../entities/agent-environment-variable.entity';
import { AgentEnvironmentVariablesService } from '../services/agent-environment-variables.service';

import { AgentsEnvironmentVariablesController } from './agents-environment-variables.controller';

describe('AgentsEnvironmentVariablesController', () => {
  let controller: AgentsEnvironmentVariablesController;
  let service: jest.Mocked<AgentEnvironmentVariablesService>;
  const mockAgentId = 'test-agent-uuid';
  const mockEnvVarId = 'test-env-var-uuid';
  const mockEnvironmentVariableEntity: AgentEnvironmentVariableEntity = {
    id: mockEnvVarId,
    agentId: mockAgentId,
    variable: 'API_KEY',
    content: 'secret-api-key-value',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  } as AgentEnvironmentVariableEntity;
  const mockEnvironmentVariableResponse: EnvironmentVariableResponseDto = {
    id: mockEnvVarId,
    agentId: mockAgentId,
    variable: 'API_KEY',
    content: 'secret-api-key-value',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockService = {
    createEnvironmentVariable: jest.fn(),
    updateEnvironmentVariable: jest.fn(),
    deleteEnvironmentVariable: jest.fn(),
    getEnvironmentVariables: jest.fn(),
    countEnvironmentVariables: jest.fn(),
    deleteAllEnvironmentVariables: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsEnvironmentVariablesController],
      providers: [
        {
          provide: AgentEnvironmentVariablesService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsEnvironmentVariablesController>(AgentsEnvironmentVariablesController);
    service = module.get(AgentEnvironmentVariablesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getEnvironmentVariables', () => {
    it('should return array of environment variables', async () => {
      const variables = [mockEnvironmentVariableEntity];

      service.getEnvironmentVariables.mockResolvedValue(variables);

      const result = await controller.getEnvironmentVariables(mockAgentId, 50, 0);

      expect(result).toEqual([mockEnvironmentVariableResponse]);
      expect(service.getEnvironmentVariables).toHaveBeenCalledWith(mockAgentId, 50, 0);
    });

    it('should use default pagination values', async () => {
      const variables = [mockEnvironmentVariableEntity];

      service.getEnvironmentVariables.mockResolvedValue(variables);

      const result = await controller.getEnvironmentVariables(mockAgentId);

      expect(result).toEqual([mockEnvironmentVariableResponse]);
      expect(service.getEnvironmentVariables).toHaveBeenCalledWith(mockAgentId, 50, 0);
    });

    it('should use custom pagination parameters', async () => {
      const variables = [mockEnvironmentVariableEntity];

      service.getEnvironmentVariables.mockResolvedValue(variables);

      const result = await controller.getEnvironmentVariables(mockAgentId, 100, 10);

      expect(result).toEqual([mockEnvironmentVariableResponse]);
      expect(service.getEnvironmentVariables).toHaveBeenCalledWith(mockAgentId, 100, 10);
    });
  });

  describe('countEnvironmentVariables', () => {
    it('should return count of environment variables', async () => {
      service.countEnvironmentVariables.mockResolvedValue(5);

      const result = await controller.countEnvironmentVariables(mockAgentId);

      expect(result).toEqual({ count: 5 });
      expect(service.countEnvironmentVariables).toHaveBeenCalledWith(mockAgentId);
    });

    it('should return zero when no environment variables exist', async () => {
      service.countEnvironmentVariables.mockResolvedValue(0);

      const result = await controller.countEnvironmentVariables(mockAgentId);

      expect(result).toEqual({ count: 0 });
    });
  });

  describe('createEnvironmentVariable', () => {
    it('should create new environment variable', async () => {
      const createDto: CreateEnvironmentVariableDto = {
        variable: 'API_KEY',
        content: 'secret-api-key-value',
      };

      service.createEnvironmentVariable.mockResolvedValue(mockEnvironmentVariableEntity);

      const result = await controller.createEnvironmentVariable(mockAgentId, createDto);

      expect(result).toEqual(mockEnvironmentVariableResponse);
      expect(service.createEnvironmentVariable).toHaveBeenCalledWith(
        mockAgentId,
        createDto.variable,
        createDto.content,
      );
    });
  });

  describe('updateEnvironmentVariable', () => {
    it('should update environment variable', async () => {
      const updateDto: UpdateEnvironmentVariableDto = {
        variable: 'UPDATED_API_KEY',
        content: 'updated-secret-value',
      };
      const updatedEntity = {
        ...mockEnvironmentVariableEntity,
        variable: 'UPDATED_API_KEY',
        content: 'updated-secret-value',
      };

      service.updateEnvironmentVariable.mockResolvedValue(updatedEntity);

      const result = await controller.updateEnvironmentVariable(mockAgentId, mockEnvVarId, updateDto);

      expect(result.variable).toBe('UPDATED_API_KEY');
      expect(result.content).toBe('updated-secret-value');
      expect(service.updateEnvironmentVariable).toHaveBeenCalledWith(
        mockEnvVarId,
        updateDto.variable,
        updateDto.content,
      );
    });
  });

  describe('deleteEnvironmentVariable', () => {
    it('should delete environment variable', async () => {
      service.deleteEnvironmentVariable.mockResolvedValue(undefined);

      await controller.deleteEnvironmentVariable(mockAgentId, mockEnvVarId);

      expect(service.deleteEnvironmentVariable).toHaveBeenCalledWith(mockEnvVarId);
    });
  });

  describe('deleteAllEnvironmentVariables', () => {
    it('should delete all environment variables for an agent', async () => {
      service.deleteAllEnvironmentVariables.mockResolvedValue(3);

      const result = await controller.deleteAllEnvironmentVariables(mockAgentId);

      expect(result).toEqual({ deletedCount: 3 });
      expect(service.deleteAllEnvironmentVariables).toHaveBeenCalledWith(mockAgentId);
    });

    it('should return zero when no environment variables are deleted', async () => {
      service.deleteAllEnvironmentVariables.mockResolvedValue(0);

      const result = await controller.deleteAllEnvironmentVariables(mockAgentId);

      expect(result).toEqual({ deletedCount: 0 });
    });
  });
});
