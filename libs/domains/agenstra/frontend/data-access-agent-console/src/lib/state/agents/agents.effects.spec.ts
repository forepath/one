import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of, throwError } from 'rxjs';

import { AgentsService } from '../../services/agents.service';
import { listDirectory, listDirectoryFailure, listDirectorySuccess } from '../files/files.actions';
import type { FileNodeDto } from '../files/files.types';

import {
  createClientAgent,
  createClientAgentFailure,
  createClientAgentSuccess,
  deleteClientAgent,
  deleteClientAgentFailure,
  deleteClientAgentSuccess,
  loadClientAgent,
  loadClientAgentCommands,
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
import {
  createClientAgent$,
  deleteClientAgent$,
  loadClientAgent$,
  loadClientAgentModels$,
  loadClientAgentCommandsFromFiles$,
  loadClientAgentCommandsLoading$,
  loadClientAgents$,
  loadClientAgentsBatch$,
  restartClientAgent$,
  startClientAgent$,
  stopClientAgent$,
  updateClientAgent$,
} from './agents.effects';
import { selectAgentsEntities } from './agents.selectors';
import type {
  AgentResponseDto,
  ContainerType,
  CreateAgentDto,
  CreateAgentResponseDto,
  UpdateAgentDto,
} from './agents.types';

describe('AgentsEffects', () => {
  let actions$: Actions;
  let agentsService: jest.Mocked<AgentsService>;
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
  const mockCreateAgentResponse: CreateAgentResponseDto = {
    ...mockAgent,
    password: 'generated-password',
  };

  beforeEach(() => {
    agentsService = {
      listClientAgents: jest.fn(),
      getClientAgent: jest.fn(),
      listClientAgentModels: jest.fn(),
      createClientAgent: jest.fn(),
      updateClientAgent: jest.fn(),
      deleteClientAgent: jest.fn(),
      startClientAgent: jest.fn(),
      stopClientAgent: jest.fn(),
      restartClientAgent: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          selectors: [
            {
              selector: selectAgentsEntities,
              value: {
                [clientId]: [mockAgent],
              },
            },
          ],
        }),
        {
          provide: AgentsService,
          useValue: agentsService,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadClientAgents$', () => {
    it('should return loadClientAgentsSuccess when batch is empty', (done) => {
      const agents: AgentResponseDto[] = [];
      const action = loadClientAgents({ clientId });
      const outcome = loadClientAgentsSuccess({ clientId, agents: [] });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadClientAgentsSuccess when batch is partial (< 10)', (done) => {
      const agents: AgentResponseDto[] = [mockAgent];
      const action = loadClientAgents({ clientId });
      const outcome = loadClientAgentsSuccess({ clientId, agents });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadClientAgentsBatch when batch is full (10 entries)', (done) => {
      const agents: AgentResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockAgent,
        id: `agent-${i}`,
      }));
      const action = loadClientAgents({ clientId });
      const outcome = loadClientAgentsBatch({ clientId, offset: 10, accumulatedAgents: agents });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 0 });
        done();
      });
    });

    it('should ignore user params and use batch params', (done) => {
      const params = { limit: 5, offset: 20 };
      const action = loadClientAgents({ clientId, params });
      const agents: AgentResponseDto[] = [mockAgent];

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe(() => {
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 0 });
        done();
      });
    });

    it('should return loadClientAgentsFailure on error', (done) => {
      const action = loadClientAgents({ clientId });
      const error = new Error('Load failed');
      const outcome = loadClientAgentsFailure({ clientId, error: 'Load failed' });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientAgentsBatch$', () => {
    it('should return loadClientAgentsSuccess when batch is empty', (done) => {
      const accumulatedAgents: AgentResponseDto[] = [mockAgent];
      const newAgents: AgentResponseDto[] = [];
      const action = loadClientAgentsBatch({ clientId, offset: 10, accumulatedAgents });
      const outcome = loadClientAgentsSuccess({ clientId, agents: accumulatedAgents });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(newAgents));

      loadClientAgentsBatch$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadClientAgentsSuccess when batch is partial (< 10)', (done) => {
      const accumulatedAgents: AgentResponseDto[] = [mockAgent];
      const newAgents: AgentResponseDto[] = [{ ...mockAgent, id: 'agent-2' }];
      const action = loadClientAgentsBatch({ clientId, offset: 10, accumulatedAgents });
      const outcome = loadClientAgentsSuccess({ clientId, agents: [...accumulatedAgents, ...newAgents] });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(newAgents));

      loadClientAgentsBatch$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadClientAgentsBatch when batch is full (10 entries)', (done) => {
      const accumulatedAgents: AgentResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockAgent,
        id: `agent-${i}`,
      }));
      const newAgents: AgentResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockAgent,
        id: `agent-${i + 10}`,
      }));
      const action = loadClientAgentsBatch({ clientId, offset: 10, accumulatedAgents });
      const outcome = loadClientAgentsBatch({
        clientId,
        offset: 20,
        accumulatedAgents: [...accumulatedAgents, ...newAgents],
      });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(newAgents));

      loadClientAgentsBatch$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 10, offset: 10 });
        done();
      });
    });

    it('should return loadClientAgentsFailure on error', (done) => {
      const accumulatedAgents: AgentResponseDto[] = [mockAgent];
      const action = loadClientAgentsBatch({ clientId, offset: 10, accumulatedAgents });
      const error = new Error('Load failed');
      const outcome = loadClientAgentsFailure({ clientId, error: 'Load failed' });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadClientAgentsBatch$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientAgent$', () => {
    it('should return loadClientAgentSuccess on success', (done) => {
      const agentId = 'agent-1';
      const action = loadClientAgent({ clientId, agentId });
      const outcome = loadClientAgentSuccess({ clientId, agent: mockAgent });

      actions$ = of(action);
      agentsService.getClientAgent.mockReturnValue(of(mockAgent));

      loadClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadClientAgentFailure on error', (done) => {
      const agentId = 'agent-1';
      const action = loadClientAgent({ clientId, agentId });
      const error = new Error('Load failed');
      const outcome = loadClientAgentFailure({ clientId, error: 'Load failed' });

      actions$ = of(action);
      agentsService.getClientAgent.mockReturnValue(throwError(() => error));

      loadClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientAgentModels$', () => {
    const agentId = 'agent-1';
    const models = { a: 'A' };

    it('should return loadClientAgentModelsSuccess on success', (done) => {
      const action = loadClientAgentModels({ clientId, agentId });
      const outcome = loadClientAgentModelsSuccess({ clientId, agentId, models });

      actions$ = of(action);
      agentsService.listClientAgentModels.mockReturnValue(of(models));

      loadClientAgentModels$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgentModels).toHaveBeenCalledWith(clientId, agentId);
        done();
      });
    });

    it('should return loadClientAgentModelsFailure on error', (done) => {
      const action = loadClientAgentModels({ clientId, agentId });
      const error = new Error('Load failed');
      const outcome = loadClientAgentModelsFailure({ clientId, agentId, error: 'Load failed' });

      actions$ = of(action);
      agentsService.listClientAgentModels.mockReturnValue(throwError(() => error));

      loadClientAgentModels$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('createClientAgent$', () => {
    it('should return createClientAgentSuccess on success', (done) => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const action = createClientAgent({ clientId, agent: createDto });
      const outcome = createClientAgentSuccess({ clientId, agent: mockCreateAgentResponse });

      actions$ = of(action);
      agentsService.createClientAgent.mockReturnValue(of(mockCreateAgentResponse));

      createClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return createClientAgentFailure on error', (done) => {
      const createDto: CreateAgentDto = {
        name: 'New Agent',
      };
      const action = createClientAgent({ clientId, agent: createDto });
      const error = new Error('Create failed');
      const outcome = createClientAgentFailure({ clientId, error: 'Create failed' });

      actions$ = of(action);
      agentsService.createClientAgent.mockReturnValue(throwError(() => error));

      createClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('updateClientAgent$', () => {
    it('should return updateClientAgentSuccess on success', (done) => {
      const agentId = 'agent-1';
      const updateDto: UpdateAgentDto = { name: 'Updated Agent' };
      const action = updateClientAgent({ clientId, agentId, agent: updateDto });
      const updatedAgent = { ...mockAgent, name: 'Updated Agent' };
      const outcome = updateClientAgentSuccess({ clientId, agent: updatedAgent });

      actions$ = of(action);
      agentsService.updateClientAgent.mockReturnValue(of(updatedAgent));

      updateClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return updateClientAgentFailure on error', (done) => {
      const agentId = 'agent-1';
      const updateDto: UpdateAgentDto = { name: 'Updated Agent' };
      const action = updateClientAgent({ clientId, agentId, agent: updateDto });
      const error = new Error('Update failed');
      const outcome = updateClientAgentFailure({ clientId, error: 'Update failed' });

      actions$ = of(action);
      agentsService.updateClientAgent.mockReturnValue(throwError(() => error));

      updateClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('deleteClientAgent$', () => {
    it('should return deleteClientAgentSuccess on success', (done) => {
      const agentId = 'agent-1';
      const action = deleteClientAgent({ clientId, agentId });
      const outcome = deleteClientAgentSuccess({ clientId, agentId });

      actions$ = of(action);
      agentsService.deleteClientAgent.mockReturnValue(of(undefined));

      deleteClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return deleteClientAgentFailure on error', (done) => {
      const agentId = 'agent-1';
      const action = deleteClientAgent({ clientId, agentId });
      const error = new Error('Delete failed');
      const outcome = deleteClientAgentFailure({ clientId, error: 'Delete failed' });

      actions$ = of(action);
      agentsService.deleteClientAgent.mockReturnValue(throwError(() => error));

      deleteClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('startClientAgent$', () => {
    it('should return startClientAgentSuccess on success', (done) => {
      const agentId = 'agent-1';
      const action = startClientAgent({ clientId, agentId });
      const outcome = startClientAgentSuccess({ clientId, agent: mockAgent });

      actions$ = of(action);
      agentsService.startClientAgent.mockReturnValue(of(mockAgent));

      startClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return startClientAgentFailure on error', (done) => {
      const agentId = 'agent-1';
      const action = startClientAgent({ clientId, agentId });
      const error = new Error('Start failed');
      const outcome = startClientAgentFailure({ clientId, error: 'Start failed' });

      actions$ = of(action);
      agentsService.startClientAgent.mockReturnValue(throwError(() => error));

      startClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('stopClientAgent$', () => {
    it('should return stopClientAgentSuccess on success', (done) => {
      const agentId = 'agent-1';
      const action = stopClientAgent({ clientId, agentId });
      const outcome = stopClientAgentSuccess({ clientId, agent: mockAgent });

      actions$ = of(action);
      agentsService.stopClientAgent.mockReturnValue(of(mockAgent));

      stopClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return stopClientAgentFailure on error', (done) => {
      const agentId = 'agent-1';
      const action = stopClientAgent({ clientId, agentId });
      const error = new Error('Stop failed');
      const outcome = stopClientAgentFailure({ clientId, error: 'Stop failed' });

      actions$ = of(action);
      agentsService.stopClientAgent.mockReturnValue(throwError(() => error));

      stopClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('restartClientAgent$', () => {
    it('should return restartClientAgentSuccess on success', (done) => {
      const agentId = 'agent-1';
      const action = restartClientAgent({ clientId, agentId });
      const outcome = restartClientAgentSuccess({ clientId, agent: mockAgent });

      actions$ = of(action);
      agentsService.restartClientAgent.mockReturnValue(of(mockAgent));

      restartClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return restartClientAgentFailure on error', (done) => {
      const agentId = 'agent-1';
      const action = restartClientAgent({ clientId, agentId });
      const error = new Error('Restart failed');
      const outcome = restartClientAgentFailure({ clientId, error: 'Restart failed' });

      actions$ = of(action);
      agentsService.restartClientAgent.mockReturnValue(throwError(() => error));

      restartClientAgent$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('error normalization', () => {
    it('should normalize Error objects', (done) => {
      const action = loadClientAgents({ clientId });
      const error = new Error('Test error');
      const outcome = loadClientAgentsFailure({ clientId, error: 'Test error' });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should normalize string errors', (done) => {
      const action = loadClientAgents({ clientId });
      const error = 'String error';
      const outcome = loadClientAgentsFailure({ clientId, error: 'String error' });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should normalize object errors with message property', (done) => {
      const action = loadClientAgents({ clientId });
      const error = { message: 'Object error' };
      const outcome = loadClientAgentsFailure({ clientId, error: 'Object error' });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should use default error message for unknown error types', (done) => {
      const action = loadClientAgents({ clientId });
      const error = { unknown: 'property' };
      const outcome = loadClientAgentsFailure({ clientId, error: 'An unexpected error occurred' });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadClientAgentCommandsLoading$', () => {
    const agentId = 'agent-1';

    it('should dispatch loadClientAgentCommands when listing .cursor/commands directory', (done) => {
      const action = listDirectory({
        clientId,
        agentId,
        params: { path: '.cursor/commands' },
      });
      const outcome = loadClientAgentCommands({ clientId, agentId });

      actions$ = of(action);

      loadClientAgentCommandsLoading$(actions$).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should ignore directory listings for other paths', (done) => {
      const action = listDirectory({
        clientId,
        agentId,
        params: { path: 'other' },
      });

      actions$ = of(action);
      let called = false;

      loadClientAgentCommandsLoading$(actions$).subscribe({
        next: () => {
          called = true;
        },
        complete: () => {
          expect(called).toBe(false);
          done();
        },
      });
    });
  });

  describe('loadClientAgentCommandsFromFiles$', () => {
    const agentId = 'agent-1';

    it('should extract commands from .md files in .cursor/commands directory', (done) => {
      const files: FileNodeDto[] = [
        { name: 'command1.md', type: 'file', path: '.cursor/commands/command1.md' },
        { name: 'command2.md', type: 'file', path: '.cursor/commands/command2.md' },
        { name: 'readme.txt', type: 'file', path: '.cursor/commands/readme.txt' },
        { name: 'subdir', type: 'directory', path: '.cursor/commands/subdir' },
      ];
      const action = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath: '.cursor/commands',
        files,
      });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: { cursor: ['/command1', '/command2'], opencode: [] },
      });

      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromFiles$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    it('should return empty commands array when no .md files exist', (done) => {
      const files: FileNodeDto[] = [
        { name: 'readme.txt', type: 'file', path: '.cursor/commands/readme.txt' },
        { name: 'subdir', type: 'directory', path: '.cursor/commands/subdir' },
      ];
      const action = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath: '.cursor/commands',
        files,
      });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: { cursor: [], opencode: [] },
      });

      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromFiles$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    it('should return empty commands array when directory listing fails', (done) => {
      const action = listDirectoryFailure({
        clientId,
        agentId,
        directoryPath: '.cursor/commands',
        error: 'Directory not found',
      });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: { cursor: [] },
      });

      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromFiles$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    it('should ignore non-.cursor/commands directory listings', (done) => {
      const files: FileNodeDto[] = [{ name: 'command1.md', type: 'file', path: 'other/command1.md' }];
      const action = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath: 'other',
        files,
      });

      actions$ = of(action);
      let called = false;

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromFiles$(actions$).subscribe({
          next: () => {
            called = true;
          },
          complete: () => {
            expect(called).toBe(false);
            done();
          },
        });
      });
    });

    it('should handle files with .md extension in subdirectories correctly', (done) => {
      const files: FileNodeDto[] = [
        { name: 'command1.md', type: 'file', path: '.cursor/commands/command1.md' },
        { name: 'subdir', type: 'directory', path: '.cursor/commands/subdir' },
      ];
      const action = listDirectorySuccess({
        clientId,
        agentId,
        directoryPath: '.cursor/commands',
        files,
      });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: { cursor: ['/command1'], opencode: [] },
      });

      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromFiles$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });
  });
});
