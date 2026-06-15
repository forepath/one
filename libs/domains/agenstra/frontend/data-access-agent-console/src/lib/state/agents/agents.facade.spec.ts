import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearSelectedClientAgent,
  createClientAgent,
  deleteClientAgent,
  loadClientAgent,
  loadClientAgentModels,
  loadClientAgents,
  restartClientAgent,
  startClientAgent,
  stopClientAgent,
  updateClientAgent,
} from './agents.actions';
import { AgentsFacade } from './agents.facade';
import type {
  AgentModelsMap,
  AgentResponseDto,
  ContainerType,
  CreateAgentDto,
  ListClientAgentsParams,
  UpdateAgentDto,
} from './agents.types';

describe('AgentsFacade', () => {
  let facade: AgentsFacade;
  let store: jest.Mocked<Store>;
  const clientId = 'client-1';
  const mockAgent: AgentResponseDto = {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'Test Description',
    agentType: 'cursor',
    containerType: 'generic' as ContainerType,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockAgent2: AgentResponseDto = {
    id: 'agent-2',
    name: 'Test Agent 2',
    agentType: 'cursor',
    containerType: 'generic' as ContainerType,
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  beforeEach(() => {
    store = {
      select: jest.fn(),
      dispatch: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        AgentsFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(AgentsFacade);
  });

  describe('State Observables', () => {
    it('should return client agents observable', (done) => {
      const agents = [mockAgent, mockAgent2];

      store.select.mockReturnValue(of(agents));

      facade.getClientAgents$(clientId).subscribe((result) => {
        expect(result).toEqual(agents);
        expect(store.select).toHaveBeenCalled();
        done();
      });
    });

    it('should return selected client agent observable', (done) => {
      store.select.mockReturnValue(of(mockAgent));

      facade.getSelectedClientAgent$(clientId).subscribe((result) => {
        expect(result).toEqual(mockAgent);
        done();
      });
    });

    it('should return null when no agent selected', (done) => {
      store.select.mockReturnValue(of(null));

      facade.getSelectedClientAgent$(clientId).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });

  describe('Loading State Observables', () => {
    it('should return client agents loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getClientAgentsLoading$(clientId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return client agent loading observable', (done) => {
      store.select.mockReturnValue(of(false));

      facade.getClientAgentLoading$(clientId).subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should return client agents creating observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getClientAgentsCreating$(clientId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return client agents updating observable', (done) => {
      store.select.mockReturnValue(of(false));

      facade.getClientAgentsUpdating$(clientId).subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should return client agents deleting observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getClientAgentsDeleting$(clientId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return client agents loading any observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getClientAgentsLoadingAny$(clientId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Error Observable', () => {
    it('should return client agents error observable', (done) => {
      const error = 'Test error';

      store.select.mockReturnValue(of(error));

      facade.getClientAgentsError$(clientId).subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });

    it('should return null when no error', (done) => {
      store.select.mockReturnValue(of(null));

      facade.getClientAgentsError$(clientId).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });

  describe('Derived State Observables', () => {
    it('should return client agents count observable', (done) => {
      const count = 5;

      store.select.mockReturnValue(of(count));

      facade.getClientAgentsCount$(clientId).subscribe((result) => {
        expect(result).toEqual(count);
        done();
      });
    });

    it('should return has client agents observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.hasClientAgents$(clientId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Agent Lookup', () => {
    it('should return client agent by ID observable', (done) => {
      const agentId = 'agent-1';

      store.select.mockReturnValue(of(mockAgent));

      facade.getClientAgentById$(clientId, agentId).subscribe((result) => {
        expect(result).toEqual(mockAgent);
        done();
      });
    });

    it('should return null when agent not found', (done) => {
      const agentId = 'non-existent';

      store.select.mockReturnValue(of(null));

      facade.getClientAgentById$(clientId, agentId).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });

  describe('Client agent models', () => {
    const agentId = 'agent-1';
    const models: AgentModelsMap = { m1: 'Model 1' };

    it('should return models observable', (done) => {
      store.select.mockReturnValue(of(models));

      facade.getClientAgentModels$(clientId, agentId).subscribe((result) => {
        expect(result).toEqual(models);
        done();
      });
    });

    it('should return models loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getClientAgentModelsLoading$(clientId, agentId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return models error observable', (done) => {
      store.select.mockReturnValue(of('boom'));

      facade.getClientAgentModelsError$(clientId, agentId).subscribe((result) => {
        expect(result).toBe('boom');
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadClientAgents action', () => {
      const params: ListClientAgentsParams = { limit: 10, offset: 0 };

      facade.loadClientAgents(clientId, params);

      expect(store.dispatch).toHaveBeenCalledWith(loadClientAgents({ clientId, params }));
    });

    it('should dispatch loadClientAgents action without params', () => {
      facade.loadClientAgents(clientId);

      expect(store.dispatch).toHaveBeenCalledWith(loadClientAgents({ clientId, params: undefined }));
    });

    it('should dispatch loadClientAgent action', () => {
      const agentId = 'agent-1';

      facade.loadClientAgent(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(loadClientAgent({ clientId, agentId }));
    });

    it('should dispatch loadClientAgentModels action', () => {
      const agentId = 'agent-1';

      facade.loadClientAgentModels(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(loadClientAgentModels({ clientId, agentId }));
    });

    it('should dispatch createClientAgent action', () => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
        description: 'New Agent Description',
      };

      facade.createClientAgent(clientId, createDto);

      expect(store.dispatch).toHaveBeenCalledWith(createClientAgent({ clientId, agent: createDto }));
    });

    it('should dispatch updateClientAgent action', () => {
      const agentId = 'agent-1';
      const updateDto: UpdateAgentDto = {
        name: 'Updated Agent',
      };

      facade.updateClientAgent(clientId, agentId, updateDto);

      expect(store.dispatch).toHaveBeenCalledWith(updateClientAgent({ clientId, agentId, agent: updateDto }));
    });

    it('should dispatch deleteClientAgent action', () => {
      const agentId = 'agent-1';

      facade.deleteClientAgent(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(deleteClientAgent({ clientId, agentId }));
    });

    it('should dispatch startClientAgent action', () => {
      const agentId = 'agent-1';

      facade.startClientAgent(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(startClientAgent({ clientId, agentId }));
    });

    it('should dispatch stopClientAgent action', () => {
      const agentId = 'agent-1';

      facade.stopClientAgent(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(stopClientAgent({ clientId, agentId }));
    });

    it('should dispatch restartClientAgent action', () => {
      const agentId = 'agent-1';

      facade.restartClientAgent(clientId, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(restartClientAgent({ clientId, agentId }));
    });

    it('should dispatch clearSelectedClientAgent action', () => {
      facade.clearSelectedClientAgent(clientId);

      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedClientAgent({ clientId }));
    });
  });

  describe('Multiple Clients', () => {
    it('should handle different client IDs independently', (done) => {
      const clientId2 = 'client-2';
      const agents1 = [mockAgent];
      const agents2 = [mockAgent2];

      // First call for client-1
      store.select.mockReturnValueOnce(of(agents1));
      facade.getClientAgents$(clientId).subscribe((result) => {
        expect(result).toEqual(agents1);
      });

      // Second call for client-2
      store.select.mockReturnValueOnce(of(agents2));
      facade.getClientAgents$(clientId2).subscribe((result) => {
        expect(result).toEqual(agents2);
        expect(store.select).toHaveBeenCalledTimes(2);
        done();
      });
    });
  });

  describe('Commands Observables', () => {
    const agentId = 'agent-1';

    it('should return client agent commands observable', (done) => {
      const commands = ['/command1', '/command2'];
      const agentType = 'cursor';

      store.select.mockReturnValue(of(commands));

      facade.getClientAgentCommands$(clientId, agentId, agentType).subscribe((result) => {
        expect(result).toEqual(commands);
        expect(store.select).toHaveBeenCalled();
        done();
      });
    });

    it('should return empty array when no commands', (done) => {
      const agentType = 'cursor';

      store.select.mockReturnValue(of([]));

      facade.getClientAgentCommands$(clientId, agentId, agentType).subscribe((result) => {
        expect(result).toEqual([]);
        done();
      });
    });

    it('should return client agent loading commands observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getClientAgentLoadingCommands$(clientId, agentId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return false when not loading commands', (done) => {
      store.select.mockReturnValue(of(false));

      facade.getClientAgentLoadingCommands$(clientId, agentId).subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });
  });
});
