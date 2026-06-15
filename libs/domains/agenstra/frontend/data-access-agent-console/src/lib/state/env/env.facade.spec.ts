import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearEnvironmentVariables,
  createEnvironmentVariable,
  deleteAllEnvironmentVariables,
  deleteEnvironmentVariable,
  loadEnvironmentVariables,
  loadEnvironmentVariablesCount,
  updateEnvironmentVariable,
} from './env.actions';
import { EnvFacade } from './env.facade';
import type {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  UpdateEnvironmentVariableDto,
} from './env.types';

describe('EnvFacade', () => {
  let facade: EnvFacade;
  let store: jest.Mocked<Store>;
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

  beforeEach(() => {
    store = {
      select: jest.fn(),
      dispatch: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        EnvFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(EnvFacade);
  });

  describe('State Observables', () => {
    it('should return environment variables observable', (done) => {
      store.select.mockReturnValue(of([mockEnvironmentVariable]));

      facade.getEnvironmentVariables$(clientId, agentId).subscribe((result) => {
        expect(result).toEqual([mockEnvironmentVariable]);
        expect(store.select).toHaveBeenCalled();
        done();
      });
    });

    it('should return null when environment variables not loaded', (done) => {
      store.select.mockReturnValue(of(null));

      facade.getEnvironmentVariables$(clientId, agentId).subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });

    it('should return count observable', (done) => {
      store.select.mockReturnValue(of(5));

      facade.getEnvironmentVariablesCount$(clientId, agentId).subscribe((result) => {
        expect(result).toBe(5);
        done();
      });
    });

    it('should return loading state observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.isLoadingEnvironmentVariables$(clientId, agentId).subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Actions', () => {
    it('should dispatch loadEnvironmentVariables', () => {
      facade.loadEnvironmentVariables(clientId, agentId);
      expect(store.dispatch).toHaveBeenCalledWith(loadEnvironmentVariables({ clientId, agentId, params: undefined }));
    });

    it('should dispatch loadEnvironmentVariables with params', () => {
      const params = { limit: 10, offset: 20 };

      facade.loadEnvironmentVariables(clientId, agentId, params);
      expect(store.dispatch).toHaveBeenCalledWith(loadEnvironmentVariables({ clientId, agentId, params }));
    });

    it('should dispatch loadEnvironmentVariablesCount', () => {
      facade.loadEnvironmentVariablesCount(clientId, agentId);
      expect(store.dispatch).toHaveBeenCalledWith(loadEnvironmentVariablesCount({ clientId, agentId }));
    });

    it('should dispatch createEnvironmentVariable', () => {
      const createDto: CreateEnvironmentVariableDto = {
        variable: 'NEW_VAR',
        content: 'new-value',
      };

      facade.createEnvironmentVariable(clientId, agentId, createDto);
      expect(store.dispatch).toHaveBeenCalledWith(createEnvironmentVariable({ clientId, agentId, createDto }));
    });

    it('should dispatch updateEnvironmentVariable', () => {
      const updateDto: UpdateEnvironmentVariableDto = {
        variable: 'UPDATED_VAR',
        content: 'updated-value',
      };

      facade.updateEnvironmentVariable(clientId, agentId, envVarId, updateDto);
      expect(store.dispatch).toHaveBeenCalledWith(
        updateEnvironmentVariable({ clientId, agentId, envVarId, updateDto }),
      );
    });

    it('should dispatch deleteEnvironmentVariable', () => {
      facade.deleteEnvironmentVariable(clientId, agentId, envVarId);
      expect(store.dispatch).toHaveBeenCalledWith(deleteEnvironmentVariable({ clientId, agentId, envVarId }));
    });

    it('should dispatch deleteAllEnvironmentVariables', () => {
      facade.deleteAllEnvironmentVariables(clientId, agentId);
      expect(store.dispatch).toHaveBeenCalledWith(deleteAllEnvironmentVariables({ clientId, agentId }));
    });

    it('should dispatch clearEnvironmentVariables', () => {
      facade.clearEnvironmentVariables(clientId, agentId);
      expect(store.dispatch).toHaveBeenCalledWith(clearEnvironmentVariables({ clientId, agentId }));
    });
  });
});
