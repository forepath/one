import {
  clearSelectedClientAgent,
  createClientAgent,
  createClientAgentFailure,
  createClientAgentSuccess,
  deleteClientAgent,
  deleteClientAgentFailure,
  deleteClientAgentSuccess,
  loadClientAgent,
  loadClientAgentCommands,
  loadClientAgentCommandsFailure,
  loadClientAgentCommandsSuccess,
  loadClientAgentFailure,
  loadClientAgentModels,
  loadClientAgentModelsFailure,
  loadClientAgentModelsSuccess,
  loadClientAgents,
  loadClientAgentsBatch,
  loadClientAgentsFailure,
  loadClientAgentsSuccess,
  loadClientAgentSuccess,
  restartClientAgent,
  restartClientAgentFailure,
  restartClientAgentSuccess,
  startClientAgent,
  startClientAgentFailure,
  startClientAgentSuccess,
  stopClientAgent,
  stopClientAgentFailure,
  stopClientAgentSuccess,
  updateClientAgent,
  updateClientAgentFailure,
  updateClientAgentSuccess,
} from './agents.actions';
import { agentsReducer, initialAgentsState, type AgentsState } from './agents.reducer';
import type { AgentResponseDto, ContainerType } from './agents.types';

describe('agentsReducer', () => {
  const clientId = 'client-1';
  const clientId2 = 'client-2';
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

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = agentsReducer(undefined, action as any);

      expect(state).toEqual(initialAgentsState);
    });
  });

  describe('loadClientAgents', () => {
    it('should set loading to true for the client, preserve existing agents, and clear error', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, loadClientAgents({ clientId, params: {} }));

      expect(newState.loading[clientId]).toBe(true);
      expect(newState.entities[clientId]).toEqual([mockAgent]);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('loadClientAgentsBatch', () => {
    it('should accumulate agents and keep loading true', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loading: { [clientId]: true },
        entities: { [clientId]: [mockAgent] },
      };
      const accumulatedAgents = [mockAgent, mockAgent2];
      const newState = agentsReducer(state, loadClientAgentsBatch({ clientId, offset: 10, accumulatedAgents }));

      expect(newState.entities[clientId]).toEqual(accumulatedAgents);
      expect(newState.loading[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('loadClientAgentsSuccess', () => {
    it('should set agents for the client and set loading to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loading: { [clientId]: true },
      };
      const newState = agentsReducer(state, loadClientAgentsSuccess({ clientId, agents: [mockAgent, mockAgent2] }));

      expect(newState.entities[clientId]).toEqual([mockAgent, mockAgent2]);
      expect(newState.loading[clientId]).toBe(false);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('loadClientAgentsFailure', () => {
    it('should set error and set loading to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loading: { [clientId]: true },
      };
      const newState = agentsReducer(state, loadClientAgentsFailure({ clientId, error: 'Load failed' }));

      expect(newState.errors[clientId]).toBe('Load failed');
      expect(newState.loading[clientId]).toBe(false);
    });
  });

  describe('loadClientAgent', () => {
    it('should set loadingAgent to true for the client and clear error', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, loadClientAgent({ clientId, agentId: 'agent-1' }));

      expect(newState.loadingAgent[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('loadClientAgentSuccess', () => {
    it('should update agent in list and set selectedAgent', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        loadingAgent: { [clientId]: true },
      };
      const updatedAgent = { ...mockAgent, name: 'Updated Name' };
      const newState = agentsReducer(state, loadClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.entities[clientId][0]).toEqual(updatedAgent);
      expect(newState.selectedAgents[clientId]).toEqual(updatedAgent);
      expect(newState.loadingAgent[clientId]).toBe(false);
    });

    it('should add agent to list if not present', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [] },
        loadingAgent: { [clientId]: true },
      };
      const newState = agentsReducer(state, loadClientAgentSuccess({ clientId, agent: mockAgent }));

      expect(newState.entities[clientId]).toContainEqual(mockAgent);
      expect(newState.selectedAgents[clientId]).toEqual(mockAgent);
    });
  });

  describe('loadClientAgentFailure', () => {
    it('should set error and set loadingAgent to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingAgent: { [clientId]: true },
      };
      const newState = agentsReducer(state, loadClientAgentFailure({ clientId, error: 'Load failed' }));

      expect(newState.errors[clientId]).toBe('Load failed');
      expect(newState.loadingAgent[clientId]).toBe(false);
    });
  });

  describe('loadClientAgentModels', () => {
    const agentId = 'agent-1';
    const key = `${clientId}:${agentId}`;

    it('should set loading and clear prior error for that client:agent key', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        agentModelsErrors: { [key]: 'old' },
      };
      const newState = agentsReducer(state, loadClientAgentModels({ clientId, agentId }));

      expect(newState.loadingAgentModels[key]).toBe(true);
      expect(newState.agentModelsErrors[key]).toBeNull();
    });
  });

  describe('loadClientAgentModelsSuccess', () => {
    const agentId = 'agent-1';
    const key = `${clientId}:${agentId}`;
    const models = { m1: 'One' };

    it('should store models and clear loading', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingAgentModels: { [key]: true },
      };
      const newState = agentsReducer(state, loadClientAgentModelsSuccess({ clientId, agentId, models }));

      expect(newState.agentModels[key]).toEqual(models);
      expect(newState.loadingAgentModels[key]).toBe(false);
      expect(newState.agentModelsErrors[key]).toBeNull();
    });
  });

  describe('loadClientAgentModelsFailure', () => {
    const agentId = 'agent-1';
    const key = `${clientId}:${agentId}`;

    it('should set error and clear loading', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingAgentModels: { [key]: true },
      };
      const newState = agentsReducer(state, loadClientAgentModelsFailure({ clientId, agentId, error: 'failed' }));

      expect(newState.agentModelsErrors[key]).toBe('failed');
      expect(newState.loadingAgentModels[key]).toBe(false);
    });
  });

  describe('createClientAgent', () => {
    it('should set creating to true for the client and clear error', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, createClientAgent({ clientId, agent: {} as any }));

      expect(newState.creating[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('createClientAgentSuccess', () => {
    it('should add agent to list and set selectedAgent', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        creating: { [clientId]: true },
      };
      const newState = agentsReducer(
        state,
        createClientAgentSuccess({ clientId, agent: { ...mockAgent2, password: 'pwd' } }),
      );

      expect(newState.entities[clientId]).toContainEqual({ ...mockAgent2, password: 'pwd' });
      expect(newState.selectedAgents[clientId]).toEqual({ ...mockAgent2, password: 'pwd' });
      expect(newState.creating[clientId]).toBe(false);
    });
  });

  describe('createClientAgentFailure', () => {
    it('should set error and set creating to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        creating: { [clientId]: true },
      };
      const newState = agentsReducer(state, createClientAgentFailure({ clientId, error: 'Create failed' }));

      expect(newState.errors[clientId]).toBe('Create failed');
      expect(newState.creating[clientId]).toBe(false);
    });
  });

  describe('updateClientAgent', () => {
    it('should set updating to true for the client and clear error', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, updateClientAgent({ clientId, agentId: 'agent-1', agent: {} }));

      expect(newState.updating[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('updateClientAgentSuccess', () => {
    it('should update agent in list', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        updating: { [clientId]: true },
      };
      const updatedAgent = { ...mockAgent, name: 'Updated Name' };
      const newState = agentsReducer(state, updateClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.entities[clientId][0]).toEqual(updatedAgent);
      expect(newState.updating[clientId]).toBe(false);
    });

    it('should update selectedAgent if it matches', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        selectedAgents: { [clientId]: mockAgent },
        updating: { [clientId]: true },
      };
      const updatedAgent = { ...mockAgent, name: 'Updated Name' };
      const newState = agentsReducer(state, updateClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.selectedAgents[clientId]).toEqual(updatedAgent);
    });

    it('should not update selectedAgent if it does not match', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent, mockAgent2] },
        selectedAgents: { [clientId]: mockAgent2 },
        updating: { [clientId]: true },
      };
      const updatedAgent = { ...mockAgent, name: 'Updated Name' };
      const newState = agentsReducer(state, updateClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.selectedAgents[clientId]).toEqual(mockAgent2);
    });
  });

  describe('updateClientAgentFailure', () => {
    it('should set error and set updating to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        updating: { [clientId]: true },
      };
      const newState = agentsReducer(state, updateClientAgentFailure({ clientId, error: 'Update failed' }));

      expect(newState.errors[clientId]).toBe('Update failed');
      expect(newState.updating[clientId]).toBe(false);
    });
  });

  describe('deleteClientAgent', () => {
    it('should set deleting to true for the client and clear error', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, deleteClientAgent({ clientId, agentId: 'agent-1' }));

      expect(newState.deleting[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('deleteClientAgentSuccess', () => {
    it('should remove agent from list', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent, mockAgent2] },
        deleting: { [clientId]: true },
      };
      const newState = agentsReducer(state, deleteClientAgentSuccess({ clientId, agentId: 'agent-1' }));

      expect(newState.entities[clientId]).not.toContainEqual(mockAgent);
      expect(newState.entities[clientId]).toContainEqual(mockAgent2);
      expect(newState.deleting[clientId]).toBe(false);
    });

    it('should clear selectedAgent if it matches deleted id', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        selectedAgents: { [clientId]: mockAgent },
        deleting: { [clientId]: true },
      };
      const newState = agentsReducer(state, deleteClientAgentSuccess({ clientId, agentId: 'agent-1' }));

      expect(newState.selectedAgents[clientId]).toBeNull();
    });

    it('should remove cached models for the deleted agent', () => {
      const agentId = 'agent-1';
      const key = `${clientId}:${agentId}`;
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        deleting: { [clientId]: true },
        agentModels: { [key]: { m: 'M' } },
        loadingAgentModels: { [key]: false },
        agentModelsErrors: { [key]: null },
      };
      const newState = agentsReducer(state, deleteClientAgentSuccess({ clientId, agentId }));

      expect(newState.agentModels[key]).toBeUndefined();
      expect(newState.loadingAgentModels[key]).toBeUndefined();
      expect(newState.agentModelsErrors[key]).toBeUndefined();
    });
  });

  describe('deleteClientAgentFailure', () => {
    it('should set error and set deleting to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        deleting: { [clientId]: true },
      };
      const newState = agentsReducer(state, deleteClientAgentFailure({ clientId, error: 'Delete failed' }));

      expect(newState.errors[clientId]).toBe('Delete failed');
      expect(newState.deleting[clientId]).toBe(false);
    });
  });

  describe('startClientAgent', () => {
    it('should set starting to true and clear error for the client', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, startClientAgent({ clientId, agentId: 'agent-1' }));

      expect(newState.starting[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('startClientAgentSuccess', () => {
    it('should update agent in list and selectedAgent and set starting to false', () => {
      const updatedAgent = { ...mockAgent, name: 'Updated Name' };
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent, mockAgent2] },
        selectedAgents: { [clientId]: mockAgent },
        starting: { [clientId]: true },
      };
      const newState = agentsReducer(state, startClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.entities[clientId]).toContainEqual(updatedAgent);
      expect(newState.selectedAgents[clientId]).toEqual(updatedAgent);
      expect(newState.starting[clientId]).toBe(false);
    });
  });

  describe('startClientAgentFailure', () => {
    it('should set error and set starting to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        starting: { [clientId]: true },
      };
      const newState = agentsReducer(state, startClientAgentFailure({ clientId, error: 'Start failed' }));

      expect(newState.errors[clientId]).toBe('Start failed');
      expect(newState.starting[clientId]).toBe(false);
    });
  });

  describe('stopClientAgent', () => {
    it('should set stopping to true and clear error for the client', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, stopClientAgent({ clientId, agentId: 'agent-1' }));

      expect(newState.stopping[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('stopClientAgentSuccess', () => {
    it('should update agent in list and selectedAgent and set stopping to false', () => {
      const updatedAgent = { ...mockAgent, name: 'Stopped Name' };
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent, mockAgent2] },
        selectedAgents: { [clientId]: mockAgent },
        stopping: { [clientId]: true },
      };
      const newState = agentsReducer(state, stopClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.entities[clientId]).toContainEqual(updatedAgent);
      expect(newState.selectedAgents[clientId]).toEqual(updatedAgent);
      expect(newState.stopping[clientId]).toBe(false);
    });
  });

  describe('stopClientAgentFailure', () => {
    it('should set error and set stopping to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        stopping: { [clientId]: true },
      };
      const newState = agentsReducer(state, stopClientAgentFailure({ clientId, error: 'Stop failed' }));

      expect(newState.errors[clientId]).toBe('Stop failed');
      expect(newState.stopping[clientId]).toBe(false);
    });
  });

  describe('restartClientAgent', () => {
    it('should set restarting to true and clear error for the client', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        errors: { [clientId]: 'Previous error' },
      };
      const newState = agentsReducer(state, restartClientAgent({ clientId, agentId: 'agent-1' }));

      expect(newState.restarting[clientId]).toBe(true);
      expect(newState.errors[clientId]).toBeNull();
    });
  });

  describe('restartClientAgentSuccess', () => {
    it('should update agent in list and selectedAgent and set restarting to false', () => {
      const updatedAgent = { ...mockAgent, name: 'Restarted Name' };
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent, mockAgent2] },
        selectedAgents: { [clientId]: mockAgent },
        restarting: { [clientId]: true },
      };
      const newState = agentsReducer(state, restartClientAgentSuccess({ clientId, agent: updatedAgent }));

      expect(newState.entities[clientId]).toContainEqual(updatedAgent);
      expect(newState.selectedAgents[clientId]).toEqual(updatedAgent);
      expect(newState.restarting[clientId]).toBe(false);
    });
  });

  describe('restartClientAgentFailure', () => {
    it('should set error and set restarting to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        restarting: { [clientId]: true },
      };
      const newState = agentsReducer(state, restartClientAgentFailure({ clientId, error: 'Restart failed' }));

      expect(newState.errors[clientId]).toBe('Restart failed');
      expect(newState.restarting[clientId]).toBe(false);
    });
  });

  describe('clearSelectedClientAgent', () => {
    it('should clear selectedAgent for the client', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent, mockAgent2] },
        selectedAgents: { [clientId]: mockAgent },
      };
      const newState = agentsReducer(state, clearSelectedClientAgent({ clientId }));

      expect(newState.selectedAgents[clientId]).toBeNull();
      // Should not affect other state
      expect(newState.entities[clientId]).toEqual([mockAgent, mockAgent2]);
    });

    it('should not affect other clients', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: {
          [clientId]: [mockAgent],
          [clientId2]: [mockAgent2],
        },
        selectedAgents: {
          [clientId]: mockAgent,
          [clientId2]: mockAgent2,
        },
      };
      const newState = agentsReducer(state, clearSelectedClientAgent({ clientId }));

      expect(newState.selectedAgents[clientId]).toBeNull();
      expect(newState.selectedAgents[clientId2]).toEqual(mockAgent2);
    });

    it('should handle clearing when no agent is selected', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        entities: { [clientId]: [mockAgent] },
        selectedAgents: { [clientId]: null },
      };
      const newState = agentsReducer(state, clearSelectedClientAgent({ clientId }));

      expect(newState.selectedAgents[clientId]).toBeNull();
    });
  });

  describe('multiple clients', () => {
    it('should handle state for multiple clients independently', () => {
      let state: AgentsState = initialAgentsState;

      // Load agents for client 1
      state = agentsReducer(state, loadClientAgentsSuccess({ clientId, agents: [mockAgent] }));

      // Load agents for client 2
      state = agentsReducer(state, loadClientAgentsSuccess({ clientId: clientId2, agents: [mockAgent2] }));

      expect(state.entities[clientId]).toEqual([mockAgent]);
      expect(state.entities[clientId2]).toEqual([mockAgent2]);

      // Delete agent from client 1 should not affect client 2
      state = agentsReducer(state, deleteClientAgentSuccess({ clientId, agentId: 'agent-1' }));

      expect(state.entities[clientId]).toEqual([]);
      expect(state.entities[clientId2]).toEqual([mockAgent2]);
    });
  });

  describe('loadClientAgentCommands', () => {
    const agentId = 'agent-1';

    it('should set loadingCommands to true for the client:agent key', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingCommands: {},
      };
      const newState = agentsReducer(state, loadClientAgentCommands({ clientId, agentId }));

      expect(newState.loadingCommands[`${clientId}:${agentId}`]).toBe(true);
    });
  });

  describe('loadClientAgentCommandsSuccess', () => {
    const agentId = 'agent-1';
    const commands = { cursor: ['/command1', '/command2'] };

    it('should set commands for the client:agent key and set loadingCommands to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingCommands: { [`${clientId}:${agentId}`]: true },
      };
      const newState = agentsReducer(state, loadClientAgentCommandsSuccess({ clientId, agentId, commands }));

      expect(newState.commands[`${clientId}:${agentId}`]).toEqual(commands);
      expect(newState.loadingCommands[`${clientId}:${agentId}`]).toBe(false);
    });

    it('should handle empty commands object', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingCommands: { [`${clientId}:${agentId}`]: true },
      };
      const newState = agentsReducer(state, loadClientAgentCommandsSuccess({ clientId, agentId, commands: {} }));

      expect(newState.commands[`${clientId}:${agentId}`]).toEqual({});
      expect(newState.loadingCommands[`${clientId}:${agentId}`]).toBe(false);
    });

    it('should not affect other client:agent keys', () => {
      const clientId2 = 'client-2';
      const agentId2 = 'agent-2';
      const state: AgentsState = {
        ...initialAgentsState,
        commands: { [`${clientId2}:${agentId2}`]: { cursor: ['/other-command'] } },
        loadingCommands: {
          [`${clientId}:${agentId}`]: true,
          [`${clientId2}:${agentId2}`]: false,
        },
      };
      const newState = agentsReducer(state, loadClientAgentCommandsSuccess({ clientId, agentId, commands }));

      expect(newState.commands[`${clientId}:${agentId}`]).toEqual(commands);
      expect(newState.commands[`${clientId2}:${agentId2}`]).toEqual({ cursor: ['/other-command'] });
    });
  });

  describe('loadClientAgentCommandsFailure', () => {
    const agentId = 'agent-1';

    it('should set loadingCommands to false', () => {
      const state: AgentsState = {
        ...initialAgentsState,
        loadingCommands: { [`${clientId}:${agentId}`]: true },
      };
      const newState = agentsReducer(state, loadClientAgentCommandsFailure({ clientId, agentId }));

      expect(newState.loadingCommands[`${clientId}:${agentId}`]).toBe(false);
    });
  });
});
