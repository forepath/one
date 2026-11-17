import { TestBed } from '@angular/core/testing';
import type { Action } from '@ngrx/store';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import type { AgentsService } from '../../services/agents.service';

import {
  createClientAgentSuccess,
  deleteClientAgentSuccess,
  loadClientAgentsRailPage,
  loadClientAgentsRailPageFailure,
  loadClientAgentsRailPageSuccess,
  loadClientAgentSuccess,
  restartClientAgentSuccess,
  startClientAgentSuccess,
  stopClientAgentSuccess,
  updateClientAgentSuccess,
} from './agents.actions';
import { loadClientAgentsRailPage$, reloadClientAgentsRailPage$ } from './agents.effects';
import { AgentsFacade } from './agents.facade';
import { agentsReducer, initialAgentsRailPageState, initialAgentsState, type AgentsState } from './agents.reducer';
import {
  selectAgentsRailPage,
  selectAgentsRailPageQuery,
  selectClientAgentsRailError,
  selectClientAgentsRailHasNext,
  selectClientAgentsRailLoading,
  selectClientAgentsRailRows,
} from './agents.selectors';
import type { AgentResponseDto, ClientAgentsRailPageQuery } from './agents.types';

function agent(id: string, name = `Environment ${id}`): AgentResponseDto {
  return {
    id,
    name,
    agentType: 'opencode',
    chats: [],
    primaryChatId: `chat-${id}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function railState(
  rows: AgentResponseDto[],
  clientId: string | null = 'client-1',
  query: ClientAgentsRailPageQuery | null = { limit: 2, offset: 2 },
): AgentsState {
  return { ...initialAgentsState, railPage: { ...initialAgentsRailPageState, clientId, rows, query } };
}

function collect<T>(source: { subscribe: (next: (value: T) => void) => unknown }): T[] {
  const emitted: T[] = [];

  source.subscribe((value) => emitted.push(value));

  return emitted;
}

describe('Agents rail page (replace-page server paging)', () => {
  const clientId = 'client-1';
  const query: ClientAgentsRailPageQuery = { limit: 2, offset: 2, search: 'web' };

  describe('reducer', () => {
    it('starts empty', () => {
      expect(initialAgentsState.railPage).toEqual({
        clientId: null,
        rows: [],
        query: null,
        hasNext: false,
        loading: false,
        error: null,
      });
    });

    it('keeps the previous page of the same workspace visible while the next one loads', () => {
      const state = agentsReducer(railState([agent('a')]), loadClientAgentsRailPage({ clientId, query }));

      expect(state.railPage).toEqual(
        expect.objectContaining({ clientId, query, rows: [agent('a')], loading: true, error: null }),
      );
    });

    it('never shows rows of another workspace while a new one loads (also for silent loads)', () => {
      const state = agentsReducer(
        railState([agent('a')], 'client-0'),
        loadClientAgentsRailPage({ clientId, query, silent: true }),
      );

      expect(state.railPage).toEqual(expect.objectContaining({ clientId, rows: [], hasNext: false, loading: true }));
    });

    it('keeps the loading state untouched for a silent reload of the same workspace', () => {
      const state = agentsReducer(railState([agent('a')]), loadClientAgentsRailPage({ clientId, query, silent: true }));

      expect(state.railPage.loading).toBe(false);
      expect(state.railPage.rows).toEqual([agent('a')]);
    });

    it('replaces the rows with the loaded page without touching the append-style list', () => {
      const base = { ...railState([agent('a'), agent('b')]), entities: { [clientId]: [agent('x')] } };
      const state = agentsReducer(
        base,
        loadClientAgentsRailPageSuccess({ clientId, agents: [agent('c')], hasNext: true }),
      );

      expect(state.railPage.rows).toEqual([agent('c')]);
      expect(state.railPage.hasNext).toBe(true);
      expect(state.entities[clientId]).toEqual([agent('x')]);
    });

    it('ignores results and failures of a workspace that is no longer listed', () => {
      const base = railState([agent('a')], 'client-2');

      expect(agentsReducer(base, loadClientAgentsRailPageSuccess({ clientId, agents: [], hasNext: false }))).toBe(base);
      expect(agentsReducer(base, loadClientAgentsRailPageFailure({ clientId, error: 'x' }))).toBe(base);
    });

    it('stores a failure and clears the rows', () => {
      const state = agentsReducer(
        railState([agent('a')]),
        loadClientAgentsRailPageFailure({ clientId, error: 'down' }),
      );

      expect(state.railPage).toEqual(expect.objectContaining({ rows: [], loading: false, error: 'down' }));
    });

    it('patches rows of the current page on single loads, updates, start, stop and restart', () => {
      let state = railState([agent('a'), agent('b')]);

      state = agentsReducer(state, loadClientAgentSuccess({ clientId, agent: agent('a', 'A1') }));
      state = agentsReducer(state, updateClientAgentSuccess({ clientId, agent: agent('b', 'B1') }));
      expect(state.railPage.rows.map((a) => a.name)).toEqual(['A1', 'B1']);

      state = agentsReducer(state, startClientAgentSuccess({ clientId, agent: agent('a', 'A2') }));
      state = agentsReducer(state, stopClientAgentSuccess({ clientId, agent: agent('b', 'B2') }));
      state = agentsReducer(state, restartClientAgentSuccess({ clientId, agent: agent('a', 'A3') }));
      expect(state.railPage.rows.map((a) => a.name)).toEqual(['A3', 'B2']);
    });

    it('does not patch rows of another workspace or environments not on the page', () => {
      const base = railState([agent('a')]);

      expect(
        agentsReducer(base, updateClientAgentSuccess({ clientId: 'client-2', agent: agent('a', 'X') })).railPage,
      ).toBe(base.railPage);
      expect(agentsReducer(base, updateClientAgentSuccess({ clientId, agent: agent('z') })).railPage).toBe(
        base.railPage,
      );
    });

    it('removes deleted environments from the current page', () => {
      const state = agentsReducer(
        railState([agent('a'), agent('b')]),
        deleteClientAgentSuccess({ clientId, agentId: 'a' }),
      );

      expect(state.railPage.rows).toEqual([agent('b')]);
    });
  });

  describe('selectors', () => {
    const root = (agents: AgentsState) => ({ agents });

    it('only return rail data for the listed workspace', () => {
      const state = {
        ...railState([agent('a')]),
        railPage: { clientId, rows: [agent('a')], query, hasNext: true, loading: true, error: 'e' },
      };

      expect(selectAgentsRailPage(root(state))).toBe(state.railPage);
      expect(selectAgentsRailPageQuery(root(state))).toEqual(query);
      expect(selectClientAgentsRailRows(clientId)(root(state))).toEqual([agent('a')]);
      expect(selectClientAgentsRailHasNext(clientId)(root(state))).toBe(true);
      expect(selectClientAgentsRailLoading(clientId)(root(state))).toBe(true);
      expect(selectClientAgentsRailError(clientId)(root(state))).toBe('e');

      expect(selectClientAgentsRailRows('other')(root(state))).toEqual([]);
      expect(selectClientAgentsRailHasNext('other')(root(state))).toBe(false);
      expect(selectClientAgentsRailLoading('other')(root(state))).toBe(false);
      expect(selectClientAgentsRailError('other')(root(state))).toBeNull();
    });

    it('fall back to an empty rail for partial states', () => {
      const partial = { ...initialAgentsState } as Partial<AgentsState>;

      delete partial.railPage;
      expect(selectClientAgentsRailRows(clientId)(root(partial as AgentsState))).toEqual([]);
    });
  });

  describe('effects', () => {
    let agentsService: jest.Mocked<Pick<AgentsService, 'listClientAgents'>>;

    beforeEach(() => {
      agentsService = { listClientAgents: jest.fn() };
    });

    it('requests one extra row and reports whether a next page exists', () => {
      agentsService.listClientAgents.mockReturnValue(of([agent('a'), agent('b'), agent('c')]));

      const emitted = collect<Action>(
        loadClientAgentsRailPage$(
          of(loadClientAgentsRailPage({ clientId, query })),
          agentsService as unknown as AgentsService,
        ),
      );

      expect(agentsService.listClientAgents).toHaveBeenCalledWith(clientId, { limit: 3, offset: 2, search: 'web' });
      expect(emitted).toEqual([
        loadClientAgentsRailPageSuccess({ clientId, agents: [agent('a'), agent('b')], hasNext: true }),
      ]);
    });

    it('reports the last page and maps errors', () => {
      agentsService.listClientAgents
        .mockReturnValueOnce(of([agent('a')]))
        .mockReturnValueOnce(throwError(() => new Error('unreachable')));

      const emitted = collect<Action>(
        loadClientAgentsRailPage$(
          of(
            loadClientAgentsRailPage({ clientId, query: { limit: 2, offset: 0 } }),
            loadClientAgentsRailPage({ clientId, query: { limit: 2, offset: 2 } }),
          ),
          agentsService as unknown as AgentsService,
        ),
      );

      expect(emitted).toEqual([
        loadClientAgentsRailPageSuccess({ clientId, agents: [agent('a')], hasNext: false }),
        loadClientAgentsRailPageFailure({ clientId, error: 'unreachable' }),
      ]);
    });

    it('silently reloads the listed page after creates and deletes of its workspace', () => {
      const store = { select: jest.fn().mockReturnValue(of(railState([agent('a')]).railPage)) };
      const emitted = collect<Action>(
        reloadClientAgentsRailPage$(
          of(
            createClientAgentSuccess({ clientId, agent: { ...agent('n'), password: 'p' } }),
            deleteClientAgentSuccess({ clientId, agentId: 'a' }),
            deleteClientAgentSuccess({ clientId: 'other', agentId: 'b' }),
          ),
          store as unknown as Store,
        ),
      );

      expect(emitted).toEqual([
        loadClientAgentsRailPage({ clientId, query: { limit: 2, offset: 2 }, silent: true }),
        loadClientAgentsRailPage({ clientId, query: { limit: 2, offset: 2 }, silent: true }),
      ]);
    });

    it('does not reload before the rail requested a page', () => {
      const store = { select: jest.fn().mockReturnValue(of(railState([], clientId, null).railPage)) };

      expect(
        collect<Action>(
          reloadClientAgentsRailPage$(
            of(deleteClientAgentSuccess({ clientId, agentId: 'a' })),
            store as unknown as Store,
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('facade', () => {
    let facade: AgentsFacade;
    let store: { dispatch: jest.Mock; select: jest.Mock };

    beforeEach(() => {
      store = { dispatch: jest.fn(), select: jest.fn().mockReturnValue(of(null)) };
      TestBed.configureTestingModule({ providers: [AgentsFacade, { provide: Store, useValue: store }] });
      facade = TestBed.inject(AgentsFacade);
    });

    it('dispatches rail page loads', () => {
      facade.loadClientAgentsRailPage(clientId, query);
      facade.loadClientAgentsRailPage(clientId, query, true);

      expect(store.dispatch).toHaveBeenNthCalledWith(1, loadClientAgentsRailPage({ clientId, query }));
      expect(store.dispatch).toHaveBeenNthCalledWith(2, loadClientAgentsRailPage({ clientId, query, silent: true }));
    });

    it('selects the rail slice of a workspace', () => {
      expect(facade.getClientAgentsRailRows$(clientId)).toBeDefined();
      expect(facade.getClientAgentsRailHasNext$(clientId)).toBeDefined();
      expect(facade.getClientAgentsRailLoading$(clientId)).toBeDefined();
      expect(facade.getClientAgentsRailError$(clientId)).toBeDefined();
      expect(store.select).toHaveBeenCalledTimes(4);
    });
  });
});
