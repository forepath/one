import { listAdminFileManagerDirectorySuccess, setAdminFileManagerView } from './admin-file-manager.actions';
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
});
