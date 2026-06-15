import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { EnvService } from '../../services/env.service';

import {
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
import {
  createEnvironmentVariable$,
  deleteAllEnvironmentVariables$,
  deleteEnvironmentVariable$,
  loadEnvironmentVariables$,
  loadEnvironmentVariablesCount$,
  updateEnvironmentVariable$,
} from './env.effects';
import type {
  CreateEnvironmentVariableDto,
  EnvironmentVariableResponseDto,
  UpdateEnvironmentVariableDto,
} from './env.types';

describe('EnvEffects', () => {
  let actions$: Actions;
  let envService: jest.Mocked<EnvService>;
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
    envService = {
      listEnvironmentVariables: jest.fn(),
      countEnvironmentVariables: jest.fn(),
      createEnvironmentVariable: jest.fn(),
      updateEnvironmentVariable: jest.fn(),
      deleteEnvironmentVariable: jest.fn(),
      deleteAllEnvironmentVariables: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: EnvService,
          useValue: envService,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadEnvironmentVariables$', () => {
    it('should return loadEnvironmentVariablesSuccess on success', (done) => {
      const action = loadEnvironmentVariables({ clientId, agentId });
      const outcome = loadEnvironmentVariablesSuccess({
        clientId,
        agentId,
        environmentVariables: [mockEnvironmentVariable],
      });

      actions$ = of(action);
      envService.listEnvironmentVariables.mockReturnValue(of([mockEnvironmentVariable]));

      loadEnvironmentVariables$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadEnvironmentVariablesFailure on error', (done) => {
      const action = loadEnvironmentVariables({ clientId, agentId });
      const error = new Error('Load failed');
      const outcome = loadEnvironmentVariablesFailure({ clientId, agentId, error: 'Load failed' });

      actions$ = of(action);
      envService.listEnvironmentVariables.mockReturnValue(throwError(() => error));

      loadEnvironmentVariables$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadEnvironmentVariablesCount$', () => {
    it('should return loadEnvironmentVariablesCountSuccess on success', (done) => {
      const action = loadEnvironmentVariablesCount({ clientId, agentId });
      const outcome = loadEnvironmentVariablesCountSuccess({ clientId, agentId, count: 5 });

      actions$ = of(action);
      envService.countEnvironmentVariables.mockReturnValue(of({ count: 5 }));

      loadEnvironmentVariablesCount$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadEnvironmentVariablesCountFailure on error', (done) => {
      const action = loadEnvironmentVariablesCount({ clientId, agentId });
      const error = new Error('Count failed');
      const outcome = loadEnvironmentVariablesCountFailure({ clientId, agentId, error: 'Count failed' });

      actions$ = of(action);
      envService.countEnvironmentVariables.mockReturnValue(throwError(() => error));

      loadEnvironmentVariablesCount$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('createEnvironmentVariable$', () => {
    it('should return createEnvironmentVariableSuccess on success', (done) => {
      const createDto: CreateEnvironmentVariableDto = {
        variable: 'NEW_VAR',
        content: 'new-value',
      };
      const action = createEnvironmentVariable({ clientId, agentId, createDto });
      const outcome = createEnvironmentVariableSuccess({
        clientId,
        agentId,
        environmentVariable: mockEnvironmentVariable,
      });

      actions$ = of(action);
      envService.createEnvironmentVariable.mockReturnValue(of(mockEnvironmentVariable));

      createEnvironmentVariable$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return createEnvironmentVariableFailure on error', (done) => {
      const createDto: CreateEnvironmentVariableDto = {
        variable: 'NEW_VAR',
        content: 'new-value',
      };
      const action = createEnvironmentVariable({ clientId, agentId, createDto });
      const error = new Error('Create failed');
      const outcome = createEnvironmentVariableFailure({ clientId, agentId, error: 'Create failed' });

      actions$ = of(action);
      envService.createEnvironmentVariable.mockReturnValue(throwError(() => error));

      createEnvironmentVariable$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('updateEnvironmentVariable$', () => {
    it('should return updateEnvironmentVariableSuccess on success', (done) => {
      const updateDto: UpdateEnvironmentVariableDto = {
        variable: 'UPDATED_VAR',
        content: 'updated-value',
      };
      const action = updateEnvironmentVariable({ clientId, agentId, envVarId, updateDto });
      const outcome = updateEnvironmentVariableSuccess({
        clientId,
        agentId,
        environmentVariable: mockEnvironmentVariable,
      });

      actions$ = of(action);
      envService.updateEnvironmentVariable.mockReturnValue(of(mockEnvironmentVariable));

      updateEnvironmentVariable$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return updateEnvironmentVariableFailure on error', (done) => {
      const updateDto: UpdateEnvironmentVariableDto = {
        variable: 'UPDATED_VAR',
        content: 'updated-value',
      };
      const action = updateEnvironmentVariable({ clientId, agentId, envVarId, updateDto });
      const error = new Error('Update failed');
      const outcome = updateEnvironmentVariableFailure({
        clientId,
        agentId,
        envVarId,
        error: 'Update failed',
      });

      actions$ = of(action);
      envService.updateEnvironmentVariable.mockReturnValue(throwError(() => error));

      updateEnvironmentVariable$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('deleteEnvironmentVariable$', () => {
    it('should return deleteEnvironmentVariableSuccess on success', (done) => {
      const action = deleteEnvironmentVariable({ clientId, agentId, envVarId });
      const outcome = deleteEnvironmentVariableSuccess({ clientId, agentId, envVarId });

      actions$ = of(action);
      envService.deleteEnvironmentVariable.mockReturnValue(of(undefined));

      deleteEnvironmentVariable$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return deleteEnvironmentVariableFailure on error', (done) => {
      const action = deleteEnvironmentVariable({ clientId, agentId, envVarId });
      const error = new Error('Delete failed');
      const outcome = deleteEnvironmentVariableFailure({
        clientId,
        agentId,
        envVarId,
        error: 'Delete failed',
      });

      actions$ = of(action);
      envService.deleteEnvironmentVariable.mockReturnValue(throwError(() => error));

      deleteEnvironmentVariable$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('deleteAllEnvironmentVariables$', () => {
    it('should return deleteAllEnvironmentVariablesSuccess on success', (done) => {
      const action = deleteAllEnvironmentVariables({ clientId, agentId });
      const outcome = deleteAllEnvironmentVariablesSuccess({ clientId, agentId, deletedCount: 3 });

      actions$ = of(action);
      envService.deleteAllEnvironmentVariables.mockReturnValue(of({ deletedCount: 3 }));

      deleteAllEnvironmentVariables$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return deleteAllEnvironmentVariablesFailure on error', (done) => {
      const action = deleteAllEnvironmentVariables({ clientId, agentId });
      const error = new Error('Delete all failed');
      const outcome = deleteAllEnvironmentVariablesFailure({
        clientId,
        agentId,
        error: 'Delete all failed',
      });

      actions$ = of(action);
      envService.deleteAllEnvironmentVariables.mockReturnValue(throwError(() => error));

      deleteAllEnvironmentVariables$(actions$, envService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });
});
