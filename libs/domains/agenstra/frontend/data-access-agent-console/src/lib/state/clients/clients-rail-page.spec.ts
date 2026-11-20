import { TestBed } from '@angular/core/testing';
import type { Action } from '@ngrx/store';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';

import type { ClientsService } from '../../services/clients.service';

import {
  createClientSuccess,
  deleteClientSuccess,
  deleteProvisionedServerSuccess,
  loadClientsRailPage,
  loadClientsRailPageFailure,
  loadClientsRailPageSuccess,
  loadClientSuccess,
  pingClients,
  refreshClientIsolationSuccess,
  resolveActiveClientSuccess,
  setActiveClientSuccess,
  updateClientSuccess,
} from './clients.actions';
import {
  loadClientsRailPage$,
  pingListedClients$,
  reloadClientsRailPage$,
  resolveActiveClient$,
} from './clients.effects';
import { ClientsFacade } from './clients.facade';
import { clientsReducer, initialClientsRailPageState, initialClientsState, type ClientsState } from './clients.reducer';
import {
  selectActiveClient,
  selectClientById,
  selectClientsRailError,
  selectClientsRailHasNext,
  selectClientsRailLoading,
  selectClientsRailPage,
  selectClientsRailPageQuery,
  selectClientsRailRows,
} from './clients.selectors';
import type { ClientIsolationSummaryDto, ClientResponseDto, ClientsRailPageQuery } from './clients.types';

function client(id: string, name = `Workspace ${id}`): ClientResponseDto {
  return {
    id,
    name,
    endpoint: `https://${id}.example.com/api`,
    authenticationType: 'api_key',
    isAutoProvisioned: false,
    canManageWorkspaceConfiguration: true,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function railState(rows: ClientResponseDto[], query: ClientsRailPageQuery | null = { limit: 2, offset: 2 }) {
  return {
    ...initialClientsState,
    railPage: { ...initialClientsRailPageState, rows, query },
  } satisfies ClientsState;
}

function collect<T>(source: { subscribe: (next: (value: T) => void) => unknown }): T[] {
  const emitted: T[] = [];

  source.subscribe((value) => emitted.push(value));

  return emitted;
}

describe('Clients rail page (replace-page server paging)', () => {
  const query: ClientsRailPageQuery = { limit: 2, offset: 2, search: 'acme' };

  describe('reducer', () => {
    it('starts empty', () => {
      expect(initialClientsState.railPage).toEqual({
        rows: [],
        query: null,
        hasNext: false,
        loading: false,
        error: null,
      });
    });

    it('stores the requested query and marks the page as loading', () => {
      const state = clientsReducer(
        { ...railState([client('a')]), railPage: { ...railState([client('a')]).railPage, error: 'old' } },
        loadClientsRailPage({ query }),
      );

      expect(state.railPage.query).toEqual(query);
      expect(state.railPage.loading).toBe(true);
      expect(state.railPage.error).toBeNull();
      // The previous page stays visible until the new one replaces it.
      expect(state.railPage.rows).toEqual([client('a')]);
    });

    it('keeps the loading state untouched for a silent reload', () => {
      const state = clientsReducer(railState([client('a')]), loadClientsRailPage({ query, silent: true }));

      expect(state.railPage.loading).toBe(false);
      expect(state.railPage.query).toEqual(query);
    });

    it('replaces the rows with the loaded page (never accumulates)', () => {
      const loaded = clientsReducer(
        clientsReducer(railState([client('a'), client('b')]), loadClientsRailPage({ query })),
        loadClientsRailPageSuccess({ clients: [client('c')], hasNext: true }),
      );

      expect(loaded.railPage.rows).toEqual([client('c')]);
      expect(loaded.railPage.hasNext).toBe(true);
      expect(loaded.railPage.loading).toBe(false);
    });

    it('does not touch the append-style list', () => {
      const base = { ...railState([]), entities: [client('x')], hasMore: true, nextOffset: 10 };
      const loaded = clientsReducer(base, loadClientsRailPageSuccess({ clients: [client('c')], hasNext: false }));

      expect(loaded.entities).toEqual([client('x')]);
      expect(loaded.hasMore).toBe(true);
      expect(loaded.nextOffset).toBe(10);
    });

    it('stores a failure and clears the rows', () => {
      const failed = clientsReducer(railState([client('a')]), loadClientsRailPageFailure({ error: 'boom' }));

      expect(failed.railPage).toEqual(
        expect.objectContaining({ rows: [], hasNext: false, loading: false, error: 'boom' }),
      );
    });

    it('patches rows of the current page on updates, single loads and isolation refreshes', () => {
      const isolation = { levels: [] } as unknown as ClientIsolationSummaryDto;
      let state = clientsReducer(
        railState([client('a'), client('b')]),
        updateClientSuccess({ client: client('a', 'A2') }),
      );

      expect(state.railPage.rows.map((c) => c.name)).toEqual(['A2', 'Workspace b']);

      state = clientsReducer(state, loadClientSuccess({ client: client('b', 'B2') }));
      expect(state.railPage.rows.map((c) => c.name)).toEqual(['A2', 'B2']);

      state = clientsReducer(state, refreshClientIsolationSuccess({ clientId: 'a', isolation }));
      expect(state.railPage.rows[0].isolation).toBe(isolation);
    });

    it('ignores updates of workspaces that are not on the current page', () => {
      const before = railState([client('a')]);
      const after = clientsReducer(before, updateClientSuccess({ client: client('z') }));

      expect(after.railPage).toBe(before.railPage);
    });

    it('removes deleted workspaces from the current page', () => {
      expect(
        clientsReducer(railState([client('a'), client('b')]), deleteClientSuccess({ id: 'a' })).railPage.rows,
      ).toEqual([client('b')]);
      expect(
        clientsReducer(railState([client('a'), client('b')]), deleteProvisionedServerSuccess({ clientId: 'b' }))
          .railPage.rows,
      ).toEqual([client('a')]);
    });

    it('activates a workspace that is only on the rail page', () => {
      const state = clientsReducer(railState([client('page-3')]), setActiveClientSuccess({ id: 'page-3' }));

      expect(state.activeClientId).toBe('page-3');
      expect(state.selectedClient).toEqual(client('page-3'));
    });

    it('resolves the active workspace by id without appending it to the list', () => {
      const active = { ...railState([]), entities: [client('a')], activeClientId: 'deep' };
      const state = clientsReducer(active, resolveActiveClientSuccess({ client: client('deep') }));

      expect(state.selectedClient).toEqual(client('deep'));
      expect(state.entities).toEqual([client('a')]);
    });

    it('ignores a resolved workspace that is no longer active', () => {
      const active = { ...railState([]), activeClientId: 'other' };

      expect(clientsReducer(active, resolveActiveClientSuccess({ client: client('deep') }))).toBe(active);
    });
  });

  describe('selectors', () => {
    const root = (clients: ClientsState) => ({ clients });

    it('select the rail slice', () => {
      const state = {
        ...railState([client('a')], query),
        railPage: { rows: [client('a')], query, hasNext: true, loading: true, error: 'e' },
      };

      expect(selectClientsRailPage(root(state))).toBe(state.railPage);
      expect(selectClientsRailRows(root(state))).toEqual([client('a')]);
      expect(selectClientsRailPageQuery(root(state))).toEqual(query);
      expect(selectClientsRailHasNext(root(state))).toBe(true);
      expect(selectClientsRailLoading(root(state))).toBe(true);
      expect(selectClientsRailError(root(state))).toBe('e');
    });

    it('fall back to an empty rail for partial states', () => {
      const partial = { ...initialClientsState } as Partial<ClientsState>;

      delete partial.railPage;
      expect(selectClientsRailRows(root(partial as ClientsState))).toEqual([]);
    });

    it('resolve the active workspace and workspaces by id from the rail page', () => {
      const state = { ...railState([client('page-3')]), entities: [client('a')], activeClientId: 'page-3' };

      expect(selectActiveClient(root(state))).toEqual(client('page-3'));
      expect(selectClientById('page-3')(root(state))).toEqual(client('page-3'));
      expect(selectClientById('a')(root(state))).toEqual(client('a'));
    });

    it('resolve a workspace by id from the resolved active workspace', () => {
      const state = { ...railState([]), selectedClient: client('deep'), activeClientId: 'deep' };

      expect(selectClientById('deep')(root(state))).toEqual(client('deep'));
      expect(selectClientById('missing')(root(state))).toBeNull();
    });
  });

  describe('effects', () => {
    let clientsService: jest.Mocked<Pick<ClientsService, 'listClients' | 'getClient'>>;
    let store: { select: jest.Mock };

    beforeEach(() => {
      clientsService = { listClients: jest.fn(), getClient: jest.fn() };
      store = { select: jest.fn() };
    });

    it('requests one extra row and reports whether a next page exists', () => {
      clientsService.listClients.mockReturnValue(of([client('a'), client('b'), client('c')]));

      const emitted = collect<Action>(
        loadClientsRailPage$(of(loadClientsRailPage({ query })), clientsService as unknown as ClientsService),
      );

      expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 3, offset: 2, search: 'acme' });
      expect(emitted).toEqual([loadClientsRailPageSuccess({ clients: [client('a'), client('b')], hasNext: true })]);
    });

    it('reports the last page when the extra row is missing', () => {
      clientsService.listClients.mockReturnValue(of([client('a')]));

      const emitted = collect<Action>(
        loadClientsRailPage$(
          of(loadClientsRailPage({ query: { limit: 2, offset: 0, search: '  ' } })),
          clientsService as unknown as ClientsService,
        ),
      );

      expect(clientsService.listClients).toHaveBeenCalledWith({ limit: 3, offset: 0, search: undefined });
      expect(emitted).toEqual([loadClientsRailPageSuccess({ clients: [client('a')], hasNext: false })]);
    });

    it('maps request errors to a failure', () => {
      clientsService.listClients.mockReturnValue(throwError(() => new Error('down')));

      const emitted = collect<Action>(
        loadClientsRailPage$(of(loadClientsRailPage({ query })), clientsService as unknown as ClientsService),
      );

      expect(emitted).toEqual([loadClientsRailPageFailure({ error: 'down' })]);
    });

    it('silently reloads the listed page after creates and deletes', () => {
      store.select.mockReturnValue(of(query));

      const emitted = collect<Action>(
        reloadClientsRailPage$(
          of(createClientSuccess({ client: { ...client('n'), apiKey: 'k' } }), deleteClientSuccess({ id: 'a' })),
          store as unknown as Store,
        ),
      );

      expect(emitted).toEqual([
        loadClientsRailPage({ query, silent: true }),
        loadClientsRailPage({ query, silent: true }),
      ]);
    });

    it('does not reload before the rail requested a page', () => {
      store.select.mockReturnValue(of(null));

      expect(
        collect<Action>(reloadClientsRailPage$(of(deleteClientSuccess({ id: 'a' })), store as unknown as Store)),
      ).toEqual([]);
    });

    it('loads an active workspace that is neither listed nor on the rail page', () => {
      store.select.mockReturnValue(of(null));
      clientsService.getClient.mockReturnValue(of(client('deep')));

      const emitted = collect<Action>(
        resolveActiveClient$(
          of(setActiveClientSuccess({ id: 'deep' })),
          clientsService as unknown as ClientsService,
          store as unknown as Store,
        ),
      );

      expect(clientsService.getClient).toHaveBeenCalledWith('deep');
      expect(emitted).toEqual([resolveActiveClientSuccess({ client: client('deep') })]);
    });

    it('does not load an active workspace that already resolves', () => {
      store.select.mockReturnValue(of(client('a')));

      const emitted = collect<Action>(
        resolveActiveClient$(
          of(setActiveClientSuccess({ id: 'a' })),
          clientsService as unknown as ClientsService,
          store as unknown as Store,
        ),
      );

      expect(clientsService.getClient).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('keeps an unresolvable active workspace unresolved', () => {
      store.select.mockReturnValue(of(null));
      clientsService.getClient.mockReturnValue(throwError(() => new Error('forbidden')));

      expect(
        collect<Action>(
          resolveActiveClient$(
            of(setActiveClientSuccess({ id: 'deep' })),
            clientsService as unknown as ClientsService,
            store as unknown as Store,
          ),
        ),
      ).toEqual([]);
    });

    it('pings workspaces of a loaded rail page', () => {
      store.select.mockReturnValue(of({ reachabilityErrors: { a: null } }));

      const emitted = collect<Action>(
        pingListedClients$(
          of(loadClientsRailPageSuccess({ clients: [client('a'), client('b')], hasNext: false })),
          store as unknown as Store,
        ),
      );

      expect(emitted).toEqual([pingClients({ clientIds: ['b'] })]);
    });
  });

  describe('facade', () => {
    let facade: ClientsFacade;
    let store: { dispatch: jest.Mock; select: jest.Mock };

    beforeEach(() => {
      store = { dispatch: jest.fn(), select: jest.fn().mockReturnValue(of(null)) };
      TestBed.configureTestingModule({ providers: [ClientsFacade, { provide: Store, useValue: store }] });
      facade = TestBed.inject(ClientsFacade);
    });

    it('dispatches rail page loads', () => {
      facade.loadClientsRailPage(query);
      facade.loadClientsRailPage(query, true);

      expect(store.dispatch).toHaveBeenNthCalledWith(1, loadClientsRailPage({ query }));
      expect(store.dispatch).toHaveBeenNthCalledWith(2, loadClientsRailPage({ query, silent: true }));
    });

    it('exposes the rail slice', () => {
      expect(facade.railRows$).toBeDefined();
      expect(facade.railHasNext$).toBeDefined();
      expect(facade.railLoading$).toBeDefined();
      expect(facade.railError$).toBeDefined();
      expect(store.select).toHaveBeenCalledWith(selectClientsRailRows);
      expect(store.select).toHaveBeenCalledWith(selectClientsRailHasNext);
      expect(store.select).toHaveBeenCalledWith(selectClientsRailLoading);
      expect(store.select).toHaveBeenCalledWith(selectClientsRailError);
    });
  });
});
