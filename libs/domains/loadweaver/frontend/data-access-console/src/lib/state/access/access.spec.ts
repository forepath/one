import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError } from 'rxjs';

import { AccessService } from '../../services/access.service';
import { clearAccess, loadAccess, loadAccessFailure, loadAccessSuccess } from './access.actions';
import { loadAccess$ } from './access.effects';
import { consoleAccessReducer, initialConsoleAccessState } from './access.reducer';
import { selectIsClusterAdmin, selectProjects, selectSeesInfrastructure } from './access.selectors';

const me = { userId: 'u1', clusterRole: null, projects: { web: 'operator', shop: 'admin' } } as const;

describe('console access state', () => {
  it('stores who the caller is and clears it', () => {
    const loading = consoleAccessReducer(initialConsoleAccessState, loadAccess());
    const loaded = consoleAccessReducer(loading, loadAccessSuccess({ me: { ...me, projects: { ...me.projects } } }));

    expect(loading.loading).toBe(true);
    expect(loaded.me?.userId).toBe('u1');
    expect(consoleAccessReducer(loaded, clearAccess())).toEqual(initialConsoleAccessState);
    expect(consoleAccessReducer(loading, loadAccessFailure({ error: 'x' }))).toMatchObject({
      loading: false,
      error: 'x',
    });
    // A failed reload doesn't keep the previous caller's roles.
    expect(consoleAccessReducer(loaded, loadAccessFailure({ error: 'x' })).me).toBeNull();
  });

  it('derives roles for navigation', () => {
    const state = { consoleAccess: { me: { ...me, projects: { ...me.projects } }, loading: false, error: null } };

    expect(selectProjects(state)).toEqual(['shop', 'web']);
    expect(selectSeesInfrastructure(state)).toBe(false);
    expect(selectIsClusterAdmin(state)).toBe(false);
    expect(
      selectIsClusterAdmin({
        consoleAccess: { ...state.consoleAccess, me: { ...state.consoleAccess.me, clusterRole: 'cluster-admin' } },
      }),
    ).toBe(true);
  });

  it('loads from the API', async () => {
    const service = { me: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadAccess())), { provide: AccessService, useValue: service }],
    });

    const actions = TestBed.inject(Actions);

    service.me.mockReturnValueOnce(of(me));
    expect(await firstValueFrom(loadAccess$(actions, service as unknown as AccessService))).toEqual(
      loadAccessSuccess({ me: me as never }),
    );

    service.me.mockReturnValueOnce(throwError(() => new Error('denied')));
    expect(await firstValueFrom(loadAccess$(actions, service as unknown as AccessService))).toEqual(
      loadAccessFailure({ error: 'denied' }),
    );
  });
});
