// The identity barrel pulls in Keycloak (ES modules only): only its logout action is needed here.
jest.mock('@forepath/identity/frontend', () => ({
  logoutSuccess: jest.requireActual('@ngrx/store').createAction('[Authentication] Logout Success'),
}));

import { logoutSuccess } from '@forepath/identity/frontend';
import { ActionReducerMap, combineReducers, createAction } from '@ngrx/store';

import { clearAccess, loadAccessSuccess } from '../access/access.actions';
import { consoleAccessReducer, initialConsoleAccessState } from '../access/access.reducer';
import { loadSearchFavouritesSuccess } from '../search/search.actions';
import { consoleSearchReducer, initialConsoleSearchState } from '../search/search.reducer';
import { CONSOLE_FEATURE_CONFIG, resetConsoleStateOnLogout } from './console-session.meta-reducer';

describe('resetConsoleStateOnLogout', () => {
  const search = resetConsoleStateOnLogout(consoleSearchReducer);
  const access = resetConsoleStateOnLogout(consoleAccessReducer);

  it('passes other actions through', () => {
    const state = search(initialConsoleSearchState, loadSearchFavouritesSuccess({ items: ['Node:n1'] }));

    expect(state.favourites).toEqual(['Node:n1']);
    expect(search(state, createAction('[Other] Something')())).toBe(state);
  });

  it.each([
    ['logoutSuccess', logoutSuccess()],
    ['clearAccess', clearAccess()],
  ])('resets a slice to its initial state on %s', (_name, action) => {
    const favourites = search(initialConsoleSearchState, loadSearchFavouritesSuccess({ items: ['Node:n1'] }));
    const me = access(
      initialConsoleAccessState,
      loadAccessSuccess({ me: { userId: 'alice', clusterRole: 'cluster-admin', projects: {} } as never }),
    );

    expect(search(favourites, action)).toEqual(initialConsoleSearchState);
    expect(access(me, action)).toEqual(initialConsoleAccessState);
  });

  it('works as a feature config for combined console slices', () => {
    const [meta] = CONSOLE_FEATURE_CONFIG.metaReducers;
    const reducers: ActionReducerMap<{ consoleSearch: typeof initialConsoleSearchState }> = {
      consoleSearch: meta(consoleSearchReducer),
    };
    const root = combineReducers(reducers);
    const loaded = root(undefined, loadSearchFavouritesSuccess({ items: ['Plan:p1'] }));

    expect(loaded.consoleSearch.favouritesLoaded).toBe(true);
    expect(root(loaded, logoutSuccess()).consoleSearch).toEqual(initialConsoleSearchState);
  });
});
