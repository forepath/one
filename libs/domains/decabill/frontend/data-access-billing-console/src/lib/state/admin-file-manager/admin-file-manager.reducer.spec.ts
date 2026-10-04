import {
  collapseAdminFileManagerPath,
  expandAdminFileManagerPath,
  listAdminFileManagerDirectorySuccess,
  refreshAdminFileManager,
  setAdminFileManagerView,
} from './admin-file-manager.actions';
import {
  adminFileManagerReducer,
  buildAdminFileManagerCacheKey,
  initialAdminFileManagerState,
} from './admin-file-manager.reducer';

describe('adminFileManagerReducer', () => {
  it('resets cache when view changes', () => {
    const seeded = {
      ...initialAdminFileManagerState,
      directoriesByPath: { 'tenant||invoices': [] },
      expandedPaths: ['', 'invoices'],
    };

    const next = adminFileManagerReducer(seeded, setAdminFileManagerView({ view: 'unified' }));

    expect(next.directoriesByPath).toEqual({});
    expect(next.expandedPaths).toEqual(['']);
    expect(next.view).toBe('unified');
  });

  it('stores directory listings by cache key', () => {
    const entries = [{ name: 'invoices', path: 'invoices', type: 'directory' as const }];
    const cacheKey = buildAdminFileManagerCacheKey('tenant', 'default', '');
    const next = adminFileManagerReducer(
      initialAdminFileManagerState,
      listAdminFileManagerDirectorySuccess({
        cacheKey,
        path: '',
        view: 'tenant',
        viewTenantId: 'default',
        entries,
      }),
    );

    expect(next.directoriesByPath[cacheKey]).toEqual(entries);
    expect(next.viewTenantId).toBe('default');
  });

  it('keeps expanded paths when refreshing', () => {
    const seeded = {
      ...initialAdminFileManagerState,
      view: 'tenant' as const,
      viewTenantId: 'default',
      directoriesByPath: { 'tenant|default|': [], 'tenant|default|customer': [] },
      expandedPaths: ['', 'customer', 'customer/invoices'],
    };

    const next = adminFileManagerReducer(seeded, refreshAdminFileManager());

    expect(next.directoriesByPath).toEqual({});
    expect(next.expandedPaths).toEqual(['', 'customer', 'customer/invoices']);
    expect(next.loadingPath).toBe('');
  });

  it('expands and collapses paths including descendants', () => {
    const expanded = adminFileManagerReducer(
      {
        ...initialAdminFileManagerState,
        expandedPaths: ['', 'customer'],
      },
      expandAdminFileManagerPath({ path: 'customer/invoices' }),
    );

    expect(expanded.expandedPaths).toEqual(['', 'customer', 'customer/invoices']);

    const collapsed = adminFileManagerReducer(expanded, collapseAdminFileManagerPath({ path: 'customer' }));

    expect(collapsed.expandedPaths).toEqual(['']);
  });
});
