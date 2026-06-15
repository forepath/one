import { Test, TestingModule } from '@nestjs/testing';

import { RunVerifierCommandsDto, RunVerifierCommandsResponseDto } from '../dto/run-verifier-commands.dto';
import { AgentsVerificationService } from '../services/agents-verification.service';

import { AgentsVerificationController } from './agents-verification.controller';

describe('AgentsVerificationController', () => {
  let controller: AgentsVerificationController;
  let service: jest.Mocked<AgentsVerificationService>;
  const mockAgentId = 'test-agent-uuid';
  const mockResponse: RunVerifierCommandsResponseDto = {
    results: [{ cmd: 'npm test', exitCode: 0, output: 'ok' }],
  };
  const mockService = {
    runVerifierCommands: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsVerificationController],
      providers: [
        {
          provide: AgentsVerificationService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AgentsVerificationController>(AgentsVerificationController);
    service = module.get(AgentsVerificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyCommands', () => {
    it('should return verifier results from service', async () => {
      const body: RunVerifierCommandsDto = {
        commands: [{ cmd: 'npm test' }],
        timeoutMs: 120_000,
      };

      service.runVerifierCommands.mockResolvedValue(mockResponse);

      const result = await controller.verifyCommands(mockAgentId, body);

      expect(result).toEqual(mockResponse);
      expect(service.runVerifierCommands).toHaveBeenCalledWith(mockAgentId, body);
    });
  });
});
