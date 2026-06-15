import {
  clearEnvironmentVariables,
  createEnvironmentVariable,
  createEnvironmentVariableFailure,
  createEnvironmentVariableSuccess,
  deleteAllEnvironmentVariables,
  deleteAllEnvironmentVariablesFailure,
  deleteAllEnvironmentVariablesSuccess,
  deleteEnvironmentVariable,
  deleteEnvironmentVariableFailure,
  deleteEnvironmentVariableSuccess,
  loadEnvironmentVariables,
  loadEnvironmentVariablesCount,
  loadEnvironmentVariablesCountFailure,
  loadEnvironmentVariablesCountSuccess,
  loadEnvironmentVariablesFailure,
  loadEnvironmentVariablesSuccess,
  updateEnvironmentVariable,
  updateEnvironmentVariableFailure,
  updateEnvironmentVariableSuccess,
} from './env.actions';
import { envReducer, initialEnvState, type EnvState } from './env.reducer';
import type { EnvironmentVariableResponseDto } from './env.types';

describe('envReducer', () => {
  const clientId = 'client-1';
  const agentId = 'agent-1';
  const envVarId = 'env-var-1';
  const mockEnvironmentVariable: EnvironmentVariableResponseDto = {
    id: envVarId,
    agentId: agentId,
    variable: 'TEST_VAR',
    content: 'test-value',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = envReducer(undefined, action as any);

      expect(state).toEqual(initialEnvState);
    });
  });

  describe('loadEnvironmentVariables', () => {
    it('should set loading to true and clear error', () => {
      const state: EnvState = {
        ...initialEnvState,
        errors: { [`${clientId}:${agentId}`]: 'Previous error' },
      };
      const newState = envReducer(state, loadEnvironmentVariables({ clientId, agentId }));
      const key = `${clientId}:${agentId}`;

      expect(newState.loading[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('loadEnvironmentVariablesSuccess', () => {
    it('should store environment variables and set loading to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        loading: { [`${clientId}:${agentId}`]: true },
      };
      const newState = envReducer(
        state,
        loadEnvironmentVariablesSuccess({
          clientId,
          agentId,
          environmentVariables: [mockEnvironmentVariable],
        }),
      );
      const key = `${clientId}:${agentId}`;

      expect(newState.environmentVariables[key]).toEqual([mockEnvironmentVariable]);
      expect(newState.loading[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('loadEnvironmentVariablesFailure', () => {
    it('should set error and set loading to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        loading: { [`${clientId}:${agentId}`]: true },
      };
      const newState = envReducer(state, loadEnvironmentVariablesFailure({ clientId, agentId, error: 'Load failed' }));
      const key = `${clientId}:${agentId}`;

      expect(newState.loading[key]).toBe(false);
      expect(newState.errors[key]).toBe('Load failed');
    });
  });

  describe('loadEnvironmentVariablesCount', () => {
    it('should set loadingCount to true and clear error', () => {
      const state: EnvState = {
        ...initialEnvState,
        errors: { [`${clientId}:${agentId}`]: 'Previous error' },
      };
      const newState = envReducer(state, loadEnvironmentVariablesCount({ clientId, agentId }));
      const key = `${clientId}:${agentId}`;

      expect(newState.loadingCount[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('loadEnvironmentVariablesCountSuccess', () => {
    it('should store count and set loadingCount to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        loadingCount: { [`${clientId}:${agentId}`]: true },
      };
      const newState = envReducer(state, loadEnvironmentVariablesCountSuccess({ clientId, agentId, count: 5 }));
      const key = `${clientId}:${agentId}`;

      expect(newState.counts[key]).toBe(5);
      expect(newState.loadingCount[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('loadEnvironmentVariablesCountFailure', () => {
    it('should set error and set loadingCount to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        loadingCount: { [`${clientId}:${agentId}`]: true },
      };
      const newState = envReducer(
        state,
        loadEnvironmentVariablesCountFailure({ clientId, agentId, error: 'Count failed' }),
      );
      const key = `${clientId}:${agentId}`;

      expect(newState.loadingCount[key]).toBe(false);
      expect(newState.errors[key]).toBe('Count failed');
    });
  });

  describe('createEnvironmentVariable', () => {
    it('should set creating to true and clear error', () => {
      const state: EnvState = {
        ...initialEnvState,
        errors: { [`${clientId}:${agentId}`]: 'Previous error' },
      };
      const newState = envReducer(
        state,
        createEnvironmentVariable({
          clientId,
          agentId,
          createDto: { variable: 'NEW_VAR', content: 'new-value' },
        }),
      );
      const key = `${clientId}:${agentId}`;

      expect(newState.creating[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('createEnvironmentVariableSuccess', () => {
    it('should add environment variable and set creating to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        creating: { [`${clientId}:${agentId}`]: true },
        environmentVariables: { [`${clientId}:${agentId}`]: [] },
      };
      const newState = envReducer(
        state,
        createEnvironmentVariableSuccess({
          clientId,
          agentId,
          environmentVariable: mockEnvironmentVariable,
        }),
      );
      const key = `${clientId}:${agentId}`;

      expect(newState.environmentVariables[key]).toContainEqual(mockEnvironmentVariable);
      expect(newState.creating[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('createEnvironmentVariableFailure', () => {
    it('should set error and set creating to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        creating: { [`${clientId}:${agentId}`]: true },
      };
      const newState = envReducer(
        state,
        createEnvironmentVariableFailure({ clientId, agentId, error: 'Create failed' }),
      );
      const key = `${clientId}:${agentId}`;

      expect(newState.creating[key]).toBe(false);
      expect(newState.errors[key]).toBe('Create failed');
    });
  });

  describe('updateEnvironmentVariable', () => {
    it('should set updating to true and clear error', () => {
      const state: EnvState = {
        ...initialEnvState,
        errors: { [`${clientId}:${agentId}:${envVarId}`]: 'Previous error' },
      };
      const newState = envReducer(
        state,
        updateEnvironmentVariable({
          clientId,
          agentId,
          envVarId,
          updateDto: { variable: 'UPDATED_VAR', content: 'updated-value' },
        }),
      );
      const envVarKey = `${clientId}:${agentId}:${envVarId}`;

      expect(newState.updating[envVarKey]).toBe(true);
      expect(newState.errors[envVarKey]).toBeNull();
    });
  });

  describe('updateEnvironmentVariableSuccess', () => {
    it('should update environment variable and set updating to false', () => {
      const updatedVar: EnvironmentVariableResponseDto = {
        ...mockEnvironmentVariable,
        variable: 'UPDATED_VAR',
        content: 'updated-value',
      };
      const state: EnvState = {
        ...initialEnvState,
        updating: { [`${clientId}:${agentId}:${envVarId}`]: true },
        environmentVariables: {
          [`${clientId}:${agentId}`]: [mockEnvironmentVariable],
        },
      };
      const newState = envReducer(
        state,
        updateEnvironmentVariableSuccess({
          clientId,
          agentId,
          environmentVariable: updatedVar,
        }),
      );
      const key = `${clientId}:${agentId}`;
      const envVarKey = `${clientId}:${agentId}:${envVarId}`;

      expect(newState.environmentVariables[key]).toContainEqual(updatedVar);
      expect(newState.updating[envVarKey]).toBe(false);
      expect(newState.errors[envVarKey]).toBeNull();
    });
  });

  describe('updateEnvironmentVariableFailure', () => {
    it('should set error and set updating to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        updating: { [`${clientId}:${agentId}:${envVarId}`]: true },
      };
      const newState = envReducer(
        state,
        updateEnvironmentVariableFailure({ clientId, agentId, envVarId, error: 'Update failed' }),
      );
      const envVarKey = `${clientId}:${agentId}:${envVarId}`;

      expect(newState.updating[envVarKey]).toBe(false);
      expect(newState.errors[envVarKey]).toBe('Update failed');
    });
  });

  describe('deleteEnvironmentVariable', () => {
    it('should set deleting to true and clear error', () => {
      const state: EnvState = {
        ...initialEnvState,
        errors: { [`${clientId}:${agentId}:${envVarId}`]: 'Previous error' },
      };
      const newState = envReducer(state, deleteEnvironmentVariable({ clientId, agentId, envVarId }));
      const envVarKey = `${clientId}:${agentId}:${envVarId}`;

      expect(newState.deleting[envVarKey]).toBe(true);
      expect(newState.errors[envVarKey]).toBeNull();
    });
  });

  describe('deleteEnvironmentVariableSuccess', () => {
    it('should remove environment variable and set deleting to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        deleting: { [`${clientId}:${agentId}:${envVarId}`]: true },
        environmentVariables: {
          [`${clientId}:${agentId}`]: [mockEnvironmentVariable],
        },
      };
      const newState = envReducer(state, deleteEnvironmentVariableSuccess({ clientId, agentId, envVarId }));
      const key = `${clientId}:${agentId}`;
      const envVarKey = `${clientId}:${agentId}:${envVarId}`;

      expect(newState.environmentVariables[key]).not.toContainEqual(mockEnvironmentVariable);
      expect(newState.deleting[envVarKey]).toBe(false);
      expect(newState.errors[envVarKey]).toBeNull();
    });
  });

  describe('deleteEnvironmentVariableFailure', () => {
    it('should set error and set deleting to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        deleting: { [`${clientId}:${agentId}:${envVarId}`]: true },
      };
      const newState = envReducer(
        state,
        deleteEnvironmentVariableFailure({ clientId, agentId, envVarId, error: 'Delete failed' }),
      );
      const envVarKey = `${clientId}:${agentId}:${envVarId}`;

      expect(newState.deleting[envVarKey]).toBe(false);
      expect(newState.errors[envVarKey]).toBe('Delete failed');
    });
  });

  describe('deleteAllEnvironmentVariables', () => {
    it('should set deletingAll to true and clear error', () => {
      const state: EnvState = {
        ...initialEnvState,
        errors: { [`${clientId}:${agentId}`]: 'Previous error' },
      };
      const newState = envReducer(state, deleteAllEnvironmentVariables({ clientId, agentId }));
      const key = `${clientId}:${agentId}`;

      expect(newState.deletingAll[key]).toBe(true);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('deleteAllEnvironmentVariablesSuccess', () => {
    it('should clear environment variables and set deletingAll to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        deletingAll: { [`${clientId}:${agentId}`]: true },
        environmentVariables: {
          [`${clientId}:${agentId}`]: [mockEnvironmentVariable],
        },
        counts: {
          [`${clientId}:${agentId}`]: 1,
        },
      };
      const newState = envReducer(state, deleteAllEnvironmentVariablesSuccess({ clientId, agentId, deletedCount: 1 }));
      const key = `${clientId}:${agentId}`;

      expect(newState.environmentVariables[key]).toEqual([]);
      expect(newState.counts[key]).toBe(0);
      expect(newState.deletingAll[key]).toBe(false);
      expect(newState.errors[key]).toBeNull();
    });
  });

  describe('deleteAllEnvironmentVariablesFailure', () => {
    it('should set error and set deletingAll to false', () => {
      const state: EnvState = {
        ...initialEnvState,
        deletingAll: { [`${clientId}:${agentId}`]: true },
      };
      const newState = envReducer(
        state,
        deleteAllEnvironmentVariablesFailure({ clientId, agentId, error: 'Delete all failed' }),
      );
      const key = `${clientId}:${agentId}`;

      expect(newState.deletingAll[key]).toBe(false);
      expect(newState.errors[key]).toBe('Delete all failed');
    });
  });

  describe('clearEnvironmentVariables', () => {
    it('should remove environment variables and count from state', () => {
      const state: EnvState = {
        ...initialEnvState,
        environmentVariables: {
          [`${clientId}:${agentId}`]: [mockEnvironmentVariable],
        },
        counts: {
          [`${clientId}:${agentId}`]: 1,
        },
      };
      const newState = envReducer(state, clearEnvironmentVariables({ clientId, agentId }));
      const key = `${clientId}:${agentId}`;

      expect(newState.environmentVariables[key]).toBeUndefined();
      expect(newState.counts[key]).toBeUndefined();
    });
  });
});
