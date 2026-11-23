import { loadAdminOverview, loadAdminOverviewFailure, loadAdminOverviewSuccess } from './admin-overview.actions';
import { adminOverviewReducer, initialAdminOverviewState } from './admin-overview.reducer';
import type { AdminOverviewResponse } from './admin-overview.types';

const overview = {
  scope: 'tenant',
  from: '2026-11-01',
  to: '2026-11-30',
  groupBy: 'day',
  tenants: [],
  combined: { metrics: {}, series: [] },
} as unknown as AdminOverviewResponse;

describe('adminOverviewReducer', () => {
  it('stores the params and starts loading', () => {
    const state = adminOverviewReducer(
      { ...initialAdminOverviewState, error: 'old' },
      loadAdminOverview({ params: { clientId: 'c1' } }),
    );

    expect(state).toEqual({ ...initialAdminOverviewState, params: { clientId: 'c1' }, loading: true });
  });

  it('stores the overview on success', () => {
    const loading = adminOverviewReducer(initialAdminOverviewState, loadAdminOverview({ params: {} }));
    const state = adminOverviewReducer(loading, loadAdminOverviewSuccess({ overview }));

    expect(state.overview).toBe(overview);
    expect(state.loading).toBe(false);
  });

  it('drops the previous overview on failure', () => {
    const loaded = { ...initialAdminOverviewState, overview };
    const state = adminOverviewReducer(loaded, loadAdminOverviewFailure({ error: 'Forbidden' }));

    expect(state.overview).toBeNull();
    expect(state.error).toBe('Forbidden');
    expect(state.loading).toBe(false);
  });
});
