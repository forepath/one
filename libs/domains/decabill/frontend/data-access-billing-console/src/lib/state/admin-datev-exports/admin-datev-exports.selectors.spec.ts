import type { AdminDatevExportListItem } from '../../types/billing.types';

import { initialAdminDatevExportsState, type AdminDatevExportsState } from './admin-datev-exports.reducer';
import {
  selectAdminDatevExportDisplayItems,
  selectAdminDatevExportItems,
  selectAdminDatevExportsError,
  selectAdminDatevExportsLoading,
  selectAdminDatevExportsScope,
  selectAdminDatevExportsState,
  selectAdminDatevExportsTriggerError,
  selectAdminDatevExportsTriggerLoading,
} from './admin-datev-exports.selectors';

describe('AdminDatevExports Selectors', () => {
  const listItem: AdminDatevExportListItem = {
    id: 'exp-1',
    scope: 'tenant',
    tenantId: 'default',
    periodYear: 2026,
    periodMonth: 1,
    status: 'completed',
    bookingCount: 1,
    invoiceCount: 1,
    debtorCount: 1,
    createdAt: '2026-02-01T00:00:00Z',
  };

  const createState = (overrides?: Partial<AdminDatevExportsState>): AdminDatevExportsState => ({
    ...initialAdminDatevExportsState,
    ...overrides,
  });

  it('selects feature state', () => {
    const state = createState({ loading: true });
    const rootState = { adminDatevExports: state };

    expect(selectAdminDatevExportsState(rootState as never)).toEqual(state);
  });

  it('selects export items', () => {
    const state = createState({ items: [listItem] });
    const rootState = { adminDatevExports: state };

    expect(selectAdminDatevExportItems(rootState as never)).toEqual([listItem]);
  });

  it('merges queued placeholders with persisted items', () => {
    const state = createState({
      scope: 'tenant',
      items: [listItem],
      queuedExports: [
        {
          clientId: 'tenant-2026-2-0',
          scope: 'tenant',
          periodYear: 2026,
          periodMonth: 2,
          queuedAt: '2026-02-01T00:00:00Z',
        },
      ],
    });
    const rootState = { adminDatevExports: state };

    expect(selectAdminDatevExportDisplayItems(rootState as never)).toEqual([
      {
        kind: 'queued',
        id: 'queued-tenant-2026-2-0',
        scope: 'tenant',
        periodYear: 2026,
        periodMonth: 2,
      },
      listItem,
    ]);
  });

  it('omits queued placeholders that already have matching items', () => {
    const state = createState({
      scope: 'tenant',
      items: [listItem],
      queuedExports: [
        {
          clientId: 'tenant-2026-1-0',
          scope: 'tenant',
          periodYear: 2026,
          periodMonth: 1,
          queuedAt: '2026-02-01T00:00:00Z',
        },
      ],
    });
    const rootState = { adminDatevExports: state };

    expect(selectAdminDatevExportDisplayItems(rootState as never)).toEqual([listItem]);
  });

  it('shows queued placeholders regardless of the active scope tab', () => {
    const state = createState({
      scope: 'tenant',
      queuedExports: [
        {
          clientId: 'unified-2026-1-0',
          scope: 'unified',
          periodYear: 2026,
          periodMonth: 1,
          queuedAt: '2026-02-01T00:00:00Z',
        },
      ],
    });
    const rootState = { adminDatevExports: state };

    expect(selectAdminDatevExportDisplayItems(rootState as never)).toEqual([
      {
        kind: 'queued',
        id: 'queued-unified-2026-1-0',
        scope: 'unified',
        periodYear: 2026,
        periodMonth: 1,
      },
    ]);
  });

  it('selects loading, error, scope, and trigger state', () => {
    const state = createState({
      loading: true,
      error: 'load failed',
      scope: 'unified',
      triggerLoading: true,
      triggerError: 'trigger failed',
    });
    const rootState = { adminDatevExports: state };

    expect(selectAdminDatevExportsLoading(rootState as never)).toBe(true);
    expect(selectAdminDatevExportsError(rootState as never)).toBe('load failed');
    expect(selectAdminDatevExportsScope(rootState as never)).toBe('unified');
    expect(selectAdminDatevExportsTriggerLoading(rootState as never)).toBe(true);
    expect(selectAdminDatevExportsTriggerError(rootState as never)).toBe('trigger failed');
  });
});
