import {
  loadAdminDatevExports,
  loadAdminDatevExportsSuccess,
  triggerDatevExportSuccess,
  expireQueuedDatevExports,
} from './admin-datev-exports.actions';
import { adminDatevExportsReducer, initialAdminDatevExportsState } from './admin-datev-exports.reducer';
import { selectAdminDatevExportDisplayItems } from './admin-datev-exports.selectors';

describe('adminDatevExportsReducer', () => {
  const listItem = {
    id: 'exp-1',
    scope: 'tenant' as const,
    tenantId: 'default',
    periodYear: 2026,
    periodMonth: 1,
    status: 'completed' as const,
    bookingCount: 2,
    invoiceCount: 1,
    debtorCount: 1,
    createdAt: '2026-02-01T00:00:00Z',
  };

  it('stores export list on success for active scope only', () => {
    const state = adminDatevExportsReducer(
      initialAdminDatevExportsState,
      loadAdminDatevExportsSuccess({
        items: [listItem],
        total: 1,
        limit: 10,
        offset: 0,
        loadedScope: 'tenant',
      }),
    );

    expect(state.items).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it('keeps active list when background load targets another scope', () => {
    const state = adminDatevExportsReducer(
      { ...initialAdminDatevExportsState, items: [listItem], scope: 'tenant' },
      loadAdminDatevExportsSuccess({
        items: [
          {
            ...listItem,
            id: 'exp-2',
            scope: 'unified',
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
        loadedScope: 'unified',
      }),
    );

    expect(state.items).toEqual([listItem]);
    expect(state.scope).toBe('tenant');
  });

  it('preserves scope on reload when preserveScope is set', () => {
    const state = adminDatevExportsReducer(
      { ...initialAdminDatevExportsState, scope: 'tenant', items: [listItem] },
      loadAdminDatevExports({ params: { scope: 'unified' }, preserveScope: true }),
    );

    expect(state.scope).toBe('tenant');
    expect(state.items).toEqual([listItem]);
  });

  it('clears items and sets scope from load params without preserveScope', () => {
    const state = adminDatevExportsReducer(
      { ...initialAdminDatevExportsState, items: [listItem] },
      loadAdminDatevExports({ params: { scope: 'unified' } }),
    );

    expect(state.scope).toBe('unified');
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(true);
  });

  it('tracks queued exports on trigger success', () => {
    const state = adminDatevExportsReducer(
      { ...initialAdminDatevExportsState, triggerLoading: true },
      triggerDatevExportSuccess({
        result: { queued: true, scope: 'tenant', year: 2026, month: 1 },
        queuedAt: '2026-02-01T00:00:00Z',
      }),
    );

    expect(state.triggerLoading).toBe(false);
    expect(state.queuedExports).toHaveLength(1);
  });

  it('removes queued exports for the loaded scope once the API returns a matching item', () => {
    const queued = {
      clientId: 'tenant-2026-1-0',
      scope: 'tenant' as const,
      periodYear: 2026,
      periodMonth: 1,
      queuedAt: '2026-02-01T00:00:00Z',
    };
    const state = adminDatevExportsReducer(
      { ...initialAdminDatevExportsState, queuedExports: [queued] },
      loadAdminDatevExportsSuccess({
        items: [listItem],
        total: 1,
        limit: 10,
        offset: 0,
        loadedScope: 'tenant',
      }),
    );

    expect(state.queuedExports).toEqual([]);
  });

  it('expires stale queued exports with an error message', () => {
    const queued = {
      clientId: 'tenant-2026-1-0',
      scope: 'tenant' as const,
      periodYear: 2026,
      periodMonth: 1,
      queuedAt: '2026-02-01T00:00:00Z',
    };
    const state = adminDatevExportsReducer(
      { ...initialAdminDatevExportsState, queuedExports: [queued] },
      expireQueuedDatevExports(),
    );

    expect(state.queuedExports).toEqual([]);
    expect(state.error).toContain('did not appear within the expected time');
  });
});

describe('selectAdminDatevExportDisplayItems', () => {
  it('shows queued exports even when the active list is for another scope', () => {
    const state = {
      ...initialAdminDatevExportsState,
      scope: 'tenant' as const,
      items: [
        {
          id: 'exp-1',
          scope: 'tenant' as const,
          tenantId: 'default',
          periodYear: 2026,
          periodMonth: 2,
          status: 'completed' as const,
          bookingCount: 1,
          invoiceCount: 1,
          debtorCount: 1,
          createdAt: '2026-02-01T00:00:00Z',
        },
      ],
      queuedExports: [
        {
          clientId: 'unified-2026-1-0',
          scope: 'unified' as const,
          periodYear: 2026,
          periodMonth: 1,
          queuedAt: '2026-02-01T00:00:00Z',
        },
      ],
    };

    const items = selectAdminDatevExportDisplayItems.projector(state);

    expect(items[0]).toEqual(
      expect.objectContaining({ kind: 'queued', scope: 'unified', periodYear: 2026, periodMonth: 1 }),
    );
  });
});
