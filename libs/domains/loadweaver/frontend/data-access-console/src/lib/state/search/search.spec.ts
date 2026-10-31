import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { GlobalSearchService } from '../../services/global-search.service';
import type { SearchAction, SearchResult } from '../../types/search.types';
import {
  globalSearch,
  globalSearchSuccess,
  recordSearchVisit,
  runSearchAction,
  runSearchActionFailure,
  runSearchActionSuccess,
  setSearchFavourite,
  setSearchFavouriteFailure,
  loadSearchFavouritesFailure,
  loadSearchFavouritesSuccess,
  setSearchFavouriteSuccess,
} from './search.actions';
import { globalSearch$, recordSearchVisit$, runSearchAction$, setSearchFavourite$ } from './search.effects';
import { consoleSearchReducer, initialConsoleSearchState, SEARCH_RECENT_MAX } from './search.reducer';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'Deployment:shop/web',
    kind: 'Deployment',
    title: 'web',
    project: 'shop',
    link: '/resources/Deployment/web?project=shop',
    favourite: false,
    ...overrides,
  };
}

const drain: SearchAction = {
  title: 'Drain node n2',
  kind: 'api',
  request: { method: 'POST', path: '/nodes/n2/drain' },
};

describe('console search state', () => {
  it('keeps only the answer of the current query and clears on an empty one', () => {
    let state = consoleSearchReducer(initialConsoleSearchState, globalSearch({ q: 'we' }));

    state = consoleSearchReducer(state, globalSearch({ q: 'web' }));
    state = consoleSearchReducer(
      state,
      globalSearchSuccess({ q: 'we', response: { results: [result()], actions: [] } }),
    );
    expect(state.results).toEqual([]);
    expect(state.loading).toBe(true);

    state = consoleSearchReducer(
      state,
      globalSearchSuccess({ q: 'web', response: { results: [result()], actions: [drain] } }),
    );
    expect(state.results).toHaveLength(1);
    expect(state.actions).toEqual([drain]);

    state = consoleSearchReducer(state, globalSearch({ q: '  ' }));
    expect(state).toMatchObject({ query: '', results: [], actions: [], loading: false });
  });

  it("drops favourites when loading them fails (never another user's list)", () => {
    const loaded = consoleSearchReducer(initialConsoleSearchState, loadSearchFavouritesSuccess({ items: ['Node:n1'] }));
    const failed = consoleSearchReducer(loaded, loadSearchFavouritesFailure({ error: 'unauthorized' }));

    expect(failed.favourites).toEqual([]);
    expect(failed.favouritesLoaded).toBe(true);
  });

  it('stars right away and takes it back when the API refuses', () => {
    let state = consoleSearchReducer(
      initialConsoleSearchState,
      globalSearchSuccess({ q: '', response: { results: [result()], actions: [] } }),
    );

    state = consoleSearchReducer(state, setSearchFavourite({ item: 'Deployment:shop/web', favourite: true }));
    expect(state.results[0].favourite).toBe(true);
    expect(state.favourites).toEqual(['Deployment:shop/web']);

    state = consoleSearchReducer(
      state,
      setSearchFavouriteFailure({ item: 'Deployment:shop/web', favourite: true, error: 'favourites need a user' }),
    );
    expect(state.results[0].favourite).toBe(false);
    expect(state.favourites).toEqual([]);
    expect(state.actionResult).toEqual({ title: 'Deployment:shop/web', ok: false, error: 'favourites need a user' });
  });

  it('keeps recent visits newest first without duplicates, bounded', () => {
    let state = initialConsoleSearchState;

    for (let i = 0; i < SEARCH_RECENT_MAX + 2; i++)
      state = consoleSearchReducer(state, recordSearchVisit({ result: result({ id: `Node:n${i}` }) }));
    state = consoleSearchReducer(state, recordSearchVisit({ result: result({ id: 'Node:n5' }) }));

    expect(state.recent).toHaveLength(SEARCH_RECENT_MAX);
    expect(state.recent[0].id).toBe('Node:n5');
    expect(state.recent.filter((r) => r.id === 'Node:n5')).toHaveLength(1);
  });

  it('tracks a running action and its outcome', () => {
    let state = consoleSearchReducer(initialConsoleSearchState, runSearchAction({ action: drain }));

    expect(state.running).toBe('Drain node n2');
    state = consoleSearchReducer(state, runSearchActionFailure({ action: drain, error: 'forbidden' }));
    expect(state).toMatchObject({
      running: null,
      actionResult: { title: 'Drain node n2', ok: false, error: 'forbidden' },
    });
  });

  it('searches the last query of a burst and skips empty ones', async () => {
    const service = { search: jest.fn().mockReturnValue(of({ results: [result()], actions: [] })) };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(globalSearch({ q: 'w' }), globalSearch({ q: ' web ', limit: 10 })))],
    });

    expect(
      await firstValueFrom(globalSearch$(TestBed.inject(Actions), service as unknown as GlobalSearchService, 0)),
    ).toEqual(globalSearchSuccess({ q: ' web ', response: { results: [result()], actions: [] } }));
    expect(service.search).toHaveBeenCalledTimes(1);
    expect(service.search).toHaveBeenCalledWith('web', 10);
  });

  it('sets favourites, records visits and runs API actions', async () => {
    const service = {
      setFavourite: jest.fn().mockReturnValue(of(undefined)),
      visited: jest.fn().mockReturnValue(throwError(() => new Error('offline'))),
      runAction: jest
        .fn()
        .mockReturnValueOnce(of({}))
        .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'forbidden' } }))),
    };
    const navigate: SearchAction = { title: 'Create plan', kind: 'navigate', link: '/plans/new' };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            setSearchFavourite({ item: 'Node:n1', favourite: false }),
            recordSearchVisit({ result: result() }),
            runSearchAction({ action: drain }),
            runSearchAction({ action: navigate }),
            runSearchAction({ action: drain }),
          ),
        ),
      ],
    });

    const actions = TestBed.inject(Actions);
    const typed = service as unknown as GlobalSearchService;

    expect(await firstValueFrom(setSearchFavourite$(actions, typed))).toEqual(
      setSearchFavouriteSuccess({ item: 'Node:n1', favourite: false }),
    );
    expect(service.setFavourite).toHaveBeenCalledWith('Node:n1', false);

    expect(await firstValueFrom(recordSearchVisit$(actions, typed).pipe(toArray()))).toEqual([]);
    expect(service.visited).toHaveBeenCalledWith('Deployment:shop/web');

    expect(await firstValueFrom(runSearchAction$(actions, typed).pipe(toArray()))).toEqual([
      runSearchActionSuccess({ action: drain }),
      runSearchActionFailure({ action: drain, error: 'forbidden' }),
    ]);
    expect(service.runAction).toHaveBeenCalledTimes(2);
  });
});
