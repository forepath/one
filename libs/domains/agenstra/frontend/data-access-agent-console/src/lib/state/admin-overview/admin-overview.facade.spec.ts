import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom } from 'rxjs';

import { loadAdminOverview } from './admin-overview.actions';
import { AdminOverviewFacade } from './admin-overview.facade';
import { initialAdminOverviewState } from './admin-overview.reducer';
import type { AdminOverviewResponse } from './admin-overview.types';

describe('AdminOverviewFacade', () => {
  let facade: AdminOverviewFacade;
  let store: MockStore;
  const overview = { scope: 'tenant' } as AdminOverviewResponse;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AdminOverviewFacade,
        provideMockStore({
          initialState: {
            adminOverview: { ...initialAdminOverviewState, overview, params: { clientId: 'c2' }, error: 'x' },
          },
        }),
      ],
    });
    facade = TestBed.inject(AdminOverviewFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('load dispatches loadAdminOverview', () => {
    facade.load({ clientId: 'c1', from: '2026-11-01' });

    expect(store.dispatch).toHaveBeenCalledWith(loadAdminOverview({ params: { clientId: 'c1', from: '2026-11-01' } }));
  });

  it('exposes the slice', async () => {
    expect(await firstValueFrom(facade.overview$)).toBe(overview);
    expect(await firstValueFrom(facade.params$)).toEqual({ clientId: 'c2' });
    expect(await firstValueFrom(facade.loading$)).toBe(false);
    expect(await firstValueFrom(facade.error$)).toBe('x');
  });
});
