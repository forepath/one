import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { firstValueFrom } from 'rxjs';

import type { AdminOverviewResponse } from '../../types/admin-overview.types';

import { loadAdminOverview } from './admin-overview.actions';
import { AdminOverviewFacade } from './admin-overview.facade';
import { initialAdminOverviewState } from './admin-overview.reducer';

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
            adminOverview: { ...initialAdminOverviewState, overview, params: { viewTenantId: 'acme' }, error: 'x' },
          },
        }),
      ],
    });
    facade = TestBed.inject(AdminOverviewFacade);
    store = TestBed.inject(MockStore);
    jest.spyOn(store, 'dispatch');
  });

  it('load dispatches loadAdminOverview', () => {
    facade.load({ viewTenantId: 'all', from: '2026-11-01' });

    expect(store.dispatch).toHaveBeenCalledWith(
      loadAdminOverview({ params: { viewTenantId: 'all', from: '2026-11-01' } }),
    );
  });

  it('exposes the slice', async () => {
    expect(await firstValueFrom(facade.overview$)).toBe(overview);
    expect(await firstValueFrom(facade.params$)).toEqual({ viewTenantId: 'acme' });
    expect(await firstValueFrom(facade.loading$)).toBe(false);
    expect(await firstValueFrom(facade.error$)).toBe('x');
  });
});
