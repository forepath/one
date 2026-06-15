import { initialAgentsState, type AgentsState } from './agents.reducer';
import {
  selectAgentsAgentModels,
  selectAgentsAgentModelsErrors,
  selectAgentsCommands,
  selectAgentsCreating,
  selectAgentsDeleting,
  selectAgentsEntities,
  selectAgentsErrors,
  selectAgentsLoading,
  selectAgentsLoadingAgent,
  selectAgentsLoadingAgentModels,
  selectAgentsLoadingCommands,
  selectAgentsState,
  selectAgentsUpdating,
  selectClientAgentById,
  selectClientAgentCommands,
  selectClientAgentLoading,
  selectClientAgentLoadingCommands,
  selectClientAgentModels,
  selectClientAgentModelsError,
  selectClientAgentModelsLoading,
  selectClientAgents,
  selectClientAgentsCount,
  selectClientAgentsCreating,
  selectClientAgentsDeleting,
  selectClientAgentsError,
  selectClientAgentsLoading,
  selectClientAgentsLoadingAny,
  selectClientAgentsRestarting,
  selectClientAgentsStarting,
  selectClientAgentsStopping,
  selectClientAgentsUpdating,
  selectHasClientAgents,
  selectSelectedAgents,
  selectSelectedClientAgent,
} from './agents.selectors';
import type { AgentResponseDto, ContainerType } from './agents.types';

describe('Agents Selectors', () => {
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
  const createState = (overrides?: Partial<AgentsState>): AgentsState => ({
    ...initialAgentsState,
    ...overrides,
  });

  describe('selectAgentsState', () => {
    it('should select the agents feature state', () => {
      const state = createState();
      const rootState = { agents: state };
      const result = selectAgentsState(rootState as any);

      expect(result).toEqual(state);
    });
  });

  describe('selectAgentsEntities', () => {
    it('should select entities', () => {
      const state = createState({
        entities: { [clientId]: [mockAgent], [clientId2]: [mockAgent2] },
      });
      const rootState = { agents: state };
      const result = selectAgentsEntities(rootState as any);

      expect(result).toEqual({ [clientId]: [mockAgent], [clientId2]: [mockAgent2] });
    });
  });

  describe('selectSelectedAgents', () => {
    it('should select selectedAgents', () => {
      const state = createState({
        selectedAgents: { [clientId]: mockAgent },
      });
      const rootState = { agents: state };
      const result = selectSelectedAgents(rootState as any);

      expect(result).toEqual({ [clientId]: mockAgent });
    });
  });

  describe('selectClientAgents', () => {
    it('should return agents for a specific client', () => {
      const state = createState({
        entities: { [clientId]: [mockAgent, mockAgent2] },
      });
      const rootState = { agents: state };
      const selector = selectClientAgents(clientId);
      const result = selector(rootState as any);

      expect(result).toEqual([mockAgent, mockAgent2]);
    });

    it('should return empty array when client has no agents', () => {
      const state = createState({
        entities: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgents(clientId);
      const result = selector(rootState as any);

      expect(result).toEqual([]);
    });
  });

  describe('selectSelectedClientAgent', () => {
    it('should return selected agent for a specific client', () => {
      const state = createState({
        selectedAgents: { [clientId]: mockAgent },
      });
      const rootState = { agents: state };
      const selector = selectSelectedClientAgent(clientId);
      const result = selector(rootState as any);

      expect(result).toEqual(mockAgent);
    });

    it('should return null when no agent is selected for client', () => {
      const state = createState({
        selectedAgents: {},
      });
      const rootState = { agents: state };
      const selector = selectSelectedClientAgent(clientId);
      const result = selector(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectClientAgentsLoading', () => {
    it('should return loading state for a specific client', () => {
      const state = createState({
        loading: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsLoading(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when loading state is not set', () => {
      const state = createState({
        loading: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsLoading(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('selectClientAgentLoading', () => {
    it('should return loadingAgent state for a specific client', () => {
      const state = createState({
        loadingAgent: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentLoading(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsCreating', () => {
    it('should return creating state for a specific client', () => {
      const state = createState({
        creating: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsCreating(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsUpdating', () => {
    it('should return updating state for a specific client', () => {
      const state = createState({
        updating: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsUpdating(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsDeleting', () => {
    it('should return deleting state for a specific client', () => {
      const state = createState({
        deleting: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsDeleting(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsStarting', () => {
    it('should return starting state for a specific client', () => {
      const state = createState({
        starting: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsStarting(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsStopping', () => {
    it('should return stopping state for a specific client', () => {
      const state = createState({
        stopping: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsStopping(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsRestarting', () => {
    it('should return restarting state for a specific client', () => {
      const state = createState({
        restarting: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsRestarting(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });
  });

  describe('selectClientAgentsError', () => {
    it('should return error for a specific client', () => {
      const state = createState({
        errors: { [clientId]: 'Test error' },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsError(clientId);
      const result = selector(rootState as any);

      expect(result).toBe('Test error');
    });

    it('should return null when no error for client', () => {
      const state = createState({
        errors: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsError(clientId);
      const result = selector(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectClientAgentsLoadingAny', () => {
    it('should return true when any loading state is true', () => {
      const state = createState({
        loading: { [clientId]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsLoadingAny(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when all loading states are false', () => {
      const state = createState({
        loading: {},
        loadingAgent: {},
        creating: {},
        updating: {},
        deleting: {},
        starting: {},
        stopping: {},
        restarting: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsLoadingAny(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('selectClientAgentsCount', () => {
    it('should return count of agents for a client', () => {
      const state = createState({
        entities: { [clientId]: [mockAgent, mockAgent2] },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsCount(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(2);
    });

    it('should return 0 when client has no agents', () => {
      const state = createState({
        entities: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgentsCount(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(0);
    });
  });

  describe('selectClientAgentById', () => {
    it('should return agent by id for a client', () => {
      const state = createState({
        entities: { [clientId]: [mockAgent, mockAgent2] },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentById(clientId, 'agent-1');
      const result = selector(rootState as any);

      expect(result).toEqual(mockAgent);
    });

    it('should return null when agent not found', () => {
      const state = createState({
        entities: { [clientId]: [mockAgent] },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentById(clientId, 'non-existent');
      const result = selector(rootState as any);

      expect(result).toBeNull();
    });
  });

  describe('selectHasClientAgents', () => {
    it('should return true when client has agents', () => {
      const state = createState({
        entities: { [clientId]: [mockAgent] },
      });
      const rootState = { agents: state };
      const selector = selectHasClientAgents(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when client has no agents', () => {
      const state = createState({
        entities: {},
      });
      const rootState = { agents: state };
      const selector = selectHasClientAgents(clientId);
      const result = selector(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('base selectors', () => {
    it('should select loading states', () => {
      const state = createState({
        loading: { [clientId]: true },
        loadingAgent: { [clientId]: false },
        creating: { [clientId]: false },
        updating: { [clientId]: false },
        deleting: { [clientId]: false },
      });
      const rootState = { agents: state };

      expect(selectAgentsLoading(rootState as any)).toEqual({ [clientId]: true });
      expect(selectAgentsLoadingAgent(rootState as any)).toEqual({ [clientId]: false });
      expect(selectAgentsCreating(rootState as any)).toEqual({ [clientId]: false });
      expect(selectAgentsUpdating(rootState as any)).toEqual({ [clientId]: false });
      expect(selectAgentsDeleting(rootState as any)).toEqual({ [clientId]: false });
    });

    it('should select errors', () => {
      const state = createState({
        errors: { [clientId]: 'Error message' },
      });
      const rootState = { agents: state };

      expect(selectAgentsErrors(rootState as any)).toEqual({ [clientId]: 'Error message' });
    });
  });

  describe('selectClientAgentCommands', () => {
    const agentId = 'agent-1';
    const agentId2 = 'agent-2';

    it('should return commands for a specific client and agent', () => {
      const commands = ['/command1', '/command2'];
      const agentType = 'cursor';
      const state = createState({
        commands: { [`${clientId}:${agentId}`]: { [agentType]: commands } },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentCommands(clientId, agentId, agentType);
      const result = selector(rootState as any);

      expect(result).toEqual(commands);
    });

    it('should return empty array when no commands exist', () => {
      const agentType = 'cursor';
      const state = createState({
        commands: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgentCommands(clientId, agentId, agentType);
      const result = selector(rootState as any);

      expect(result).toEqual([]);
    });

    it('should not return commands for different client:agent combination', () => {
      const commands = ['/command1', '/command2'];
      const agentType = 'cursor';
      const state = createState({
        commands: { [`${clientId}:${agentId}`]: { [agentType]: commands } },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentCommands(clientId2, agentId2, agentType);
      const result = selector(rootState as any);

      expect(result).toEqual([]);
    });
  });

  describe('selectClientAgentLoadingCommands', () => {
    const agentId = 'agent-1';
    const agentId2 = 'agent-2';

    it('should return loading state for a specific client and agent', () => {
      const state = createState({
        loadingCommands: { [`${clientId}:${agentId}`]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentLoadingCommands(clientId, agentId);
      const result = selector(rootState as any);

      expect(result).toBe(true);
    });

    it('should return false when loading state is not set', () => {
      const state = createState({
        loadingCommands: {},
      });
      const rootState = { agents: state };
      const selector = selectClientAgentLoadingCommands(clientId, agentId);
      const result = selector(rootState as any);

      expect(result).toBe(false);
    });

    it('should not return loading state for different client:agent combination', () => {
      const state = createState({
        loadingCommands: { [`${clientId}:${agentId}`]: true },
      });
      const rootState = { agents: state };
      const selector = selectClientAgentLoadingCommands(clientId2, agentId2);
      const result = selector(rootState as any);

      expect(result).toBe(false);
    });
  });

  describe('base selectors for commands', () => {
    it('should select commands', () => {
      const state = createState({
        commands: { 'client-1:agent-1': { cursor: ['/command1'] } },
      });
      const rootState = { agents: state };

      expect(selectAgentsCommands(rootState as any)).toEqual({ 'client-1:agent-1': { cursor: ['/command1'] } });
    });

    it('should select loadingCommands', () => {
      const state = createState({
        loadingCommands: { 'client-1:agent-1': true },
      });
      const rootState = { agents: state };

      expect(selectAgentsLoadingCommands(rootState as any)).toEqual({ 'client-1:agent-1': true });
    });
  });

  describe('agent models selectors', () => {
    const agentId = 'agent-1';
    const key = `${clientId}:${agentId}`;

    it('should select agentModels map via base selector', () => {
      const state = createState({
        agentModels: { [key]: { m: 'M' } },
      });
      const rootState = { agents: state };

      expect(selectAgentsAgentModels(rootState as any)).toEqual({ [key]: { m: 'M' } });
      expect(selectAgentsLoadingAgentModels(rootState as any)).toEqual({});
      expect(selectAgentsAgentModelsErrors(rootState as any)).toEqual({});
    });

    it('should return models for client and agent', () => {
      const state = createState({
        agentModels: { [key]: { a: 'A' } },
      });
      const rootState = { agents: state };
      const result = selectClientAgentModels(clientId, agentId)(rootState as any);

      expect(result).toEqual({ a: 'A' });
    });

    it('should return null when models not loaded for key', () => {
      const state = createState({ agentModels: {} });
      const rootState = { agents: state };
      const result = selectClientAgentModels(clientId, agentId)(rootState as any);

      expect(result).toBeNull();
    });

    it('should return loading and error for client and agent', () => {
      const state = createState({
        loadingAgentModels: { [key]: true },
        agentModelsErrors: { [key]: 'err' },
      });
      const rootState = { agents: state };

      expect(selectClientAgentModelsLoading(clientId, agentId)(rootState as any)).toBe(true);
      expect(selectClientAgentModelsError(clientId, agentId)(rootState as any)).toBe('err');
    });
  });
});
