import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';

import { AgentsService } from '../../services/agents.service';
import { OpencodeConfigService, type OpencodeCommandsListDto } from '../../services/opencode-config.service';
import {
  forwardedEventReceived,
  remoteReconnected,
  setClientSuccess,
} from '../container-socket/container-socket.actions';
import { selectSelectedClientId } from '../container-socket/container-socket.selectors';
import { initialAgentsState } from './agents.reducer';

import {
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
  loadMoreClientAgents,
  loadMoreClientAgentsFailure,
  loadMoreClientAgentsSuccess,
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
  refreshAgentCatalogsOnConfigSynced$,
  loadClientAgentCommandsFromConfig$,
  loadClientAgents$,
  loadMoreClientAgents$,
  restartClientAgent$,
  startClientAgent$,
  stopClientAgent$,
  updateClientAgent$,
} from './agents.effects';
import { selectAgentsEntities, selectAgentsState } from './agents.selectors';
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
  let opencodeConfigService: jest.Mocked<OpencodeConfigService>;
  let store: jest.Mocked<Store>;
  const clientId = 'client-1';
  const mockAgent: AgentResponseDto = {
    id: 'agent-1',
    name: 'Test Agent',
    description: 'Test Description',
    agentType: 'opencode',
    containerType: 'generic' as ContainerType,
    chats: [],
    primaryChatId: 'primary-chat-1',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  const mockAgent2: AgentResponseDto = {
    ...mockAgent,
    id: 'agent-2',
    name: 'Test Agent 2',
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

    opencodeConfigService = {
      getAgent: jest.fn(),
      listAgentCommands: jest.fn(),
    } as any;

    store = {
      select: jest.fn().mockReturnValue(
        of({
          [clientId]: [mockAgent],
        }),
      ),
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
        {
          provide: OpencodeConfigService,
          useValue: opencodeConfigService,
        },
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('refreshAgentCatalogsOnConfigSynced$', () => {
    beforeEach(() => {
      store.select.mockImplementation((selector) => {
        if (selector === selectSelectedClientId) {
          return of(clientId);
        }

        expect(selector).toBe(selectAgentsState);

        return of({
          ...initialAgentsState,
          agentModels: { 'client-1:agent-1': {}, 'client-1:agent-2': {}, 'other-client:agent-1': {} },
          commands: { 'client-1:agent-1': [] },
        });
      });
    });

    it('reloads the affected catalogs after config-only or recreating syncs', async () => {
      actions$ = of(
        forwardedEventReceived({
          event: 'opencodeConfigSynced',
          payload: { success: true, data: { agentId: 'agent-1' }, timestamp: '2024-01-01' },
        }),
      );

      expect(await firstValueFrom(refreshAgentCatalogsOnConfigSynced$(actions$, store).pipe(toArray()))).toEqual([
        loadClientAgentModels({ clientId, agentId: 'agent-1' }),
        loadClientAgentCommands({ clientId, agentId: 'agent-1' }),
      ]);
    });

    it.each([setClientSuccess({ clientId }), remoteReconnected({ clientId })])(
      'refreshes cached catalogs when reconnecting/selecting a workspace: $type',
      async (action) => {
        actions$ = of(action);

        expect(await firstValueFrom(refreshAgentCatalogsOnConfigSynced$(actions$, store).pipe(toArray()))).toEqual([
          loadClientAgentModels({ clientId, agentId: 'agent-1' }),
          loadClientAgentCommands({ clientId, agentId: 'agent-1' }),
          loadClientAgentModels({ clientId, agentId: 'agent-2' }),
        ]);
      },
    );

    it('ignores unrelated, failed, malformed and uncached notifications', async () => {
      actions$ = of(
        forwardedEventReceived({ event: 'other', payload: {} }),
        forwardedEventReceived({ event: 'opencodeConfigSynced', payload: { success: false } }),
        forwardedEventReceived({ event: 'opencodeConfigSynced', payload: { success: true, data: {} } }),
        forwardedEventReceived({
          event: 'opencodeConfigSynced',
          payload: { success: true, data: { agentId: 'uncached-agent' } },
        }),
      );

      expect(await firstValueFrom(refreshAgentCatalogsOnConfigSynced$(actions$, store).pipe(toArray()))).toEqual([]);
    });

    it('ignores notifications without a selected workspace', async () => {
      store.select.mockImplementation((selector) =>
        of(selector === selectSelectedClientId ? null : initialAgentsState),
      );
      actions$ = of(
        forwardedEventReceived({
          event: 'opencodeConfigSynced',
          payload: { success: true, data: { agentId: 'agent-1' } },
        }),
      );

      expect(await firstValueFrom(refreshAgentCatalogsOnConfigSynced$(actions$, store).pipe(toArray()))).toEqual([]);
    });

    it('retries a previously failed model catalog after sync', async () => {
      store.select.mockImplementation((selector) =>
        of(
          selector === selectSelectedClientId
            ? clientId
            : {
                ...initialAgentsState,
                agentModelsErrors: { 'client-1:agent-1': 'Worker unavailable' },
              },
        ),
      );
      actions$ = of(
        forwardedEventReceived({
          event: 'opencodeConfigSynced',
          payload: { success: true, data: { agentId: 'agent-1' } },
        }),
      );

      expect(await firstValueFrom(refreshAgentCatalogsOnConfigSynced$(actions$, store).pipe(toArray()))).toEqual([
        loadClientAgentModels({ clientId, agentId: 'agent-1' }),
      ]);
    });
  });

  describe('loadClientAgents$', () => {
    it('should return loadClientAgentsSuccess when page is empty', (done) => {
      const agents: AgentResponseDto[] = [];
      const action = loadClientAgents({ clientId });
      const outcome = loadClientAgentsSuccess({ clientId, agents: [], hasMore: false, nextOffset: 0 });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, {
          limit: 10,
          offset: 0,
          search: undefined,
        });
        done();
      });
    });

    it('should return loadClientAgentsSuccess when page is partial', (done) => {
      const agents: AgentResponseDto[] = [mockAgent];
      const action = loadClientAgents({ clientId });
      const outcome = loadClientAgentsSuccess({ clientId, agents, hasMore: false, nextOffset: 1 });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should set hasMore when page is full', (done) => {
      const agents: AgentResponseDto[] = Array.from({ length: 10 }, (_, i) => ({
        ...mockAgent,
        id: `agent-${i}`,
      }));
      const action = loadClientAgents({ clientId });
      const outcome = loadClientAgentsSuccess({ clientId, agents, hasMore: true, nextOffset: 10 });

      actions$ = of(action);
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadClientAgents$(actions$, agentsService).subscribe((result) => {
        expect(result).toEqual(outcome);
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

  describe('loadMoreClientAgents$', () => {
    it('should append next page', (done) => {
      const agents: AgentResponseDto[] = [mockAgent2];
      const action = loadMoreClientAgents({ clientId });
      const outcome = loadMoreClientAgentsSuccess({
        clientId,
        agents,
        hasMore: false,
        nextOffset: 11,
      });

      actions$ = of(action);
      store.select.mockReturnValue(
        of({
          hasMore: { [clientId]: true },
          nextOffset: { [clientId]: 10 },
          loading: { [clientId]: false },
          appendLoading: { [clientId]: false },
          search: {},
        }),
      );
      agentsService.listClientAgents.mockReturnValue(of(agents));

      loadMoreClientAgents$(actions$, agentsService, store).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, {
          limit: 10,
          offset: 10,
          search: undefined,
        });
        done();
      });
    });

    it('should return loadMoreClientAgentsFailure on error', (done) => {
      const action = loadMoreClientAgents({ clientId });
      const error = new Error('Append failed');
      const outcome = loadMoreClientAgentsFailure({ clientId, error: 'Append failed' });

      actions$ = of(action);
      store.select.mockReturnValue(
        of({
          hasMore: { [clientId]: true },
          nextOffset: { [clientId]: 10 },
          loading: { [clientId]: false },
          appendLoading: { [clientId]: false },
          search: {},
        }),
      );
      agentsService.listClientAgents.mockReturnValue(throwError(() => error));

      loadMoreClientAgents$(actions$, agentsService, store).subscribe((result) => {
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
    it('keeps refreshes of different agents alive and replaces stale requests for the same agent', () => {
      const requests = new Subject<ReturnType<typeof loadClientAgentModels>>();
      const first = new Subject<Record<string, string>>();
      const second = new Subject<Record<string, string>>();
      const replacement = new Subject<Record<string, string>>();
      agentsService.listClientAgentModels
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second)
        .mockReturnValueOnce(replacement);
      const results: unknown[] = [];
      const subscription = loadClientAgentModels$(requests, agentsService).subscribe((action) => results.push(action));

      requests.next(loadClientAgentModels({ clientId, agentId: 'agent-1' }));
      requests.next(loadClientAgentModels({ clientId, agentId: 'agent-2' }));
      requests.next(loadClientAgentModels({ clientId, agentId: 'agent-1' }));
      first.next({ stale: 'stale' });
      second.next({ second: 'second' });
      replacement.next({ updated: 'updated' });

      expect(results).toEqual([
        loadClientAgentModelsSuccess({ clientId, agentId: 'agent-2', models: { second: 'second' } }),
        loadClientAgentModelsSuccess({ clientId, agentId: 'agent-1', models: { updated: 'updated' } }),
      ]);
      subscription.unsubscribe();
    });
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

  describe('loadClientAgentCommandsFromConfig$', () => {
    const agentId = 'agent-1';

    it('keeps command refreshes independent across environments', () => {
      const requests = new Subject<ReturnType<typeof loadClientAgentCommands>>();
      const first = new Subject<OpencodeCommandsListDto>();
      const second = new Subject<OpencodeCommandsListDto>();
      opencodeConfigService.listAgentCommands.mockReturnValueOnce(first).mockReturnValueOnce(second);
      const results: unknown[] = [];
      const subscription = loadClientAgentCommandsFromConfig$(requests, opencodeConfigService).subscribe((action) =>
        results.push(action),
      );

      requests.next(loadClientAgentCommands({ clientId, agentId }));
      requests.next(loadClientAgentCommands({ clientId, agentId: 'agent-2' }));
      first.next({ commands: [{ name: 'custom', description: 'Custom', source: 'command' }] });
      second.next({ commands: [{ name: 'other', description: 'Other', source: 'command' }] });

      expect(results).toEqual([
        loadClientAgentCommandsSuccess({
          clientId,
          agentId,
          commands: [{ name: '/custom', description: 'Custom', source: 'command' }],
        }),
        loadClientAgentCommandsSuccess({
          clientId,
          agentId: 'agent-2',
          commands: [{ name: '/other', description: 'Other', source: 'command' }],
        }),
      ]);
      subscription.unsubscribe();
    });

    it('should load slash commands from the OpenCode worker command list', (done) => {
      const action = loadClientAgentCommands({ clientId, agentId });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: [
          { name: '/review', description: 'Review', source: 'command' },
          { name: '/ship', description: 'Ship it', source: 'command' },
          { name: '/typescript', description: 'TS patterns', source: 'skill' },
        ],
      });

      opencodeConfigService.listAgentCommands = jest.fn().mockReturnValue(
        of({
          commands: [
            { name: 'ship', description: 'Ship it', source: 'command' },
            { name: 'review', description: 'Review', source: 'command' },
            { name: 'typescript', description: 'TS patterns', source: 'skill' },
          ],
        }),
      );
      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromConfig$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    it('should include inherited additive command keys from higher layers', (done) => {
      const action = loadClientAgentCommands({ clientId, agentId });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: [
          { name: '/global-cmd' },
          { name: '/init', description: 'guided AGENTS.md setup' },
          { name: '/local-cmd' },
          { name: '/review', description: 'review changes [commit|branch|pr], defaults to uncommitted' },
          { name: '/workspace-cmd' },
        ],
      });

      opencodeConfigService.listAgentCommands = jest.fn().mockReturnValue(of({ commands: [] }));
      opencodeConfigService.getAgent.mockReturnValue(
        of({
          config: { commands: { 'local-cmd': { template: 'Local' } } },
          secretKeys: [],
          effective: {
            commands: {
              'local-cmd': { template: 'Local' },
              'workspace-cmd': { template: 'Workspace' },
            },
          },
          inheritedAdditive: [{ path: '/commands', keys: ['global-cmd', 'workspace-cmd'] }],
        }),
      );
      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromConfig$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    it('should fall back to overlay config commands when effective is absent', (done) => {
      const action = loadClientAgentCommands({ clientId, agentId });
      const outcome = loadClientAgentCommandsSuccess({
        clientId,
        agentId,
        commands: [
          { name: '/init', description: 'guided AGENTS.md setup' },
          { name: '/review', description: 'review changes [commit|branch|pr], defaults to uncommitted' },
          { name: '/ship' },
        ],
      });

      opencodeConfigService.listAgentCommands = jest.fn().mockReturnValue(throwError(() => new Error('offline')));
      opencodeConfigService.getAgent.mockReturnValue(
        of({
          config: { commands: { ship: { template: 'Ship' } } },
          secretKeys: [],
        }),
      );
      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromConfig$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });

    it('should return loadClientAgentCommandsFailure on error', (done) => {
      const action = loadClientAgentCommands({ clientId, agentId });
      const outcome = loadClientAgentCommandsFailure({ clientId, agentId });

      opencodeConfigService.listAgentCommands = jest.fn().mockReturnValue(of({ commands: [] }));
      opencodeConfigService.getAgent.mockReturnValue(throwError(() => new Error('Config failed')));
      actions$ = of(action);

      TestBed.runInInjectionContext(() => {
        loadClientAgentCommandsFromConfig$(actions$).subscribe((result) => {
          expect(result).toEqual(outcome);
          done();
        });
      });
    });
  });
});
