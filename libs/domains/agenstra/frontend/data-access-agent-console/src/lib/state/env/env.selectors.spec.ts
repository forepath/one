import type { EnvState } from './env.reducer';
import {
  selectEnvError,
  selectEnvironmentVariableOperationLoading,
  selectEnvironmentVariablesCount,
  selectEnvironmentVariablesForAgent,
  selectEnvironmentVariablesOperationLoading,
  selectEnvState,
  selectEnvVarError,
  selectIsCreatingEnvironmentVariable,
  selectIsDeletingAllEnvironmentVariables,
  selectIsDeletingEnvironmentVariable,
  selectIsLoadingEnvironmentVariables,
  selectIsLoadingEnvironmentVariablesCount,
  selectIsUpdatingEnvironmentVariable,
} from './env.selectors';
import type { EnvironmentVariableResponseDto } from './env.types';

describe('Env Selectors', () => {
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const envVarId = 'env-var-1';
  const key = `${clientId}:${agentId}`;
  const envVarKey = `${clientId}:${agentId}:${envVarId}`;
  const mockEnvironmentVariable: EnvironmentVariableResponseDto = {
    id: envVarId,
    agentId: agentId,
    variable: 'TEST_VAR',
    content: 'test-value',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockEnvState: EnvState = {
    environmentVariables: { [key]: [mockEnvironmentVariable] },
    counts: { [key]: 1 },
    loading: { [key]: true },
    loadingCount: { [key]: false },
    creating: { [key]: false },
    updating: { [envVarKey]: false },
    deleting: { [envVarKey]: false },
    deletingAll: { [key]: false },
    errors: { [key]: null },
  };

  describe('selectEnvState', () => {
    it('should select the env state', () => {
      const result = selectEnvState.projector(mockEnvState);

      expect(result).toEqual(mockEnvState);
    });
  });

  describe('selectEnvironmentVariablesForAgent', () => {
    it('should return environment variables when they exist', () => {
      const selector = selectEnvironmentVariablesForAgent(clientId, agentId);
      const result = selector.projector(mockEnvState.environmentVariables);

      expect(result).toEqual([mockEnvironmentVariable]);
    });

    it('should return null when environment variables do not exist', () => {
      const selector = selectEnvironmentVariablesForAgent(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBeNull();
    });
  });

  describe('selectEnvironmentVariablesCount', () => {
    it('should return count when it exists', () => {
      const selector = selectEnvironmentVariablesCount(clientId, agentId);
      const result = selector.projector(mockEnvState.counts);

      expect(result).toBe(1);
    });

    it('should return null when count does not exist', () => {
      const selector = selectEnvironmentVariablesCount(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBeNull();
    });
  });

  describe('selectIsLoadingEnvironmentVariables', () => {
    it('should return true when loading', () => {
      const selector = selectIsLoadingEnvironmentVariables(clientId, agentId);
      const result = selector.projector(mockEnvState.loading);

      expect(result).toBe(true);
    });

    it('should return false when not loading', () => {
      const selector = selectIsLoadingEnvironmentVariables(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBe(false);
    });
  });

  describe('selectIsLoadingEnvironmentVariablesCount', () => {
    it('should return true when loading count', () => {
      const state = { ...mockEnvState, loadingCount: { [key]: true } };
      const selector = selectIsLoadingEnvironmentVariablesCount(clientId, agentId);
      const result = selector.projector(state.loadingCount);

      expect(result).toBe(true);
    });

    it('should return false when not loading count', () => {
      const selector = selectIsLoadingEnvironmentVariablesCount(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBe(false);
    });
  });

  describe('selectIsCreatingEnvironmentVariable', () => {
    it('should return true when creating', () => {
      const state = { ...mockEnvState, creating: { [key]: true } };
      const selector = selectIsCreatingEnvironmentVariable(clientId, agentId);
      const result = selector.projector(state.creating);

      expect(result).toBe(true);
    });

    it('should return false when not creating', () => {
      const selector = selectIsCreatingEnvironmentVariable(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBe(false);
    });
  });

  describe('selectIsUpdatingEnvironmentVariable', () => {
    it('should return true when updating', () => {
      const state = { ...mockEnvState, updating: { [envVarKey]: true } };
      const selector = selectIsUpdatingEnvironmentVariable(clientId, agentId, envVarId);
      const result = selector.projector(state.updating);

      expect(result).toBe(true);
    });

    it('should return false when not updating', () => {
      const selector = selectIsUpdatingEnvironmentVariable(clientId, agentId, envVarId);
      const result = selector.projector({});

      expect(result).toBe(false);
    });
  });

  describe('selectIsDeletingEnvironmentVariable', () => {
    it('should return true when deleting', () => {
      const state = { ...mockEnvState, deleting: { [envVarKey]: true } };
      const selector = selectIsDeletingEnvironmentVariable(clientId, agentId, envVarId);
      const result = selector.projector(state.deleting);

      expect(result).toBe(true);
    });

    it('should return false when not deleting', () => {
      const selector = selectIsDeletingEnvironmentVariable(clientId, agentId, envVarId);
      const result = selector.projector({});

      expect(result).toBe(false);
    });
  });

  describe('selectIsDeletingAllEnvironmentVariables', () => {
    it('should return true when deleting all', () => {
      const state = { ...mockEnvState, deletingAll: { [key]: true } };
      const selector = selectIsDeletingAllEnvironmentVariables(clientId, agentId);
      const result = selector.projector(state.deletingAll);

      expect(result).toBe(true);
    });

    it('should return false when not deleting all', () => {
      const selector = selectIsDeletingAllEnvironmentVariables(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBe(false);
    });
  });

  describe('selectEnvError', () => {
    it('should return error when it exists', () => {
      const state = { ...mockEnvState, errors: { [key]: 'Error message' } };
      const selector = selectEnvError(clientId, agentId);
      const result = selector.projector(state.errors);

      expect(result).toBe('Error message');
    });

    it('should return null when error does not exist', () => {
      const selector = selectEnvError(clientId, agentId);
      const result = selector.projector({});

      expect(result).toBeNull();
    });
  });

  describe('selectEnvVarError', () => {
    it('should return error when it exists', () => {
      const state = { ...mockEnvState, errors: { [envVarKey]: 'Error message' } };
      const selector = selectEnvVarError(clientId, agentId, envVarId);
      const result = selector.projector(state.errors);

      expect(result).toBe('Error message');
    });

    it('should return null when error does not exist', () => {
      const selector = selectEnvVarError(clientId, agentId, envVarId);
      const result = selector.projector({});

      expect(result).toBeNull();
    });
  });

  describe('selectEnvironmentVariablesOperationLoading', () => {
    it('should return true when any operation is loading', () => {
      const selector = selectEnvironmentVariablesOperationLoading(clientId, agentId);
      const loading = true;
      const creating = false;
      const deletingAll = false;
      const result = selector.projector(loading, creating, deletingAll);

      expect(result).toBe(true);
    });

    it('should return false when no operations are loading', () => {
      const selector = selectEnvironmentVariablesOperationLoading(clientId, agentId);
      const loading = false;
      const creating = false;
      const deletingAll = false;
      const result = selector.projector(loading, creating, deletingAll);

      expect(result).toBe(false);
    });
  });

  describe('selectEnvironmentVariableOperationLoading', () => {
    it('should return true when updating or deleting', () => {
      const selector = selectEnvironmentVariableOperationLoading(clientId, agentId, envVarId);
      const updating = true;
      const deleting = false;
      const result = selector.projector(updating, deleting);

      expect(result).toBe(true);
    });

    it('should return false when not updating or deleting', () => {
      const selector = selectEnvironmentVariableOperationLoading(clientId, agentId, envVarId);
      const updating = false;
      const deleting = false;
      const result = selector.projector(updating, deleting);

      expect(result).toBe(false);
    });
  });
});
