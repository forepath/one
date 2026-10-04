import {
  clearAdminFileManagerDocumentIdLookup,
  clearAdminFileManagerVerifyResult,
  collapseAdminFileManagerPath,
  downloadAdminFileManagerByDocumentId,
  downloadAdminFileManagerByDocumentIdFailure,
  downloadAdminFileManagerByDocumentIdSuccess,
  expandAdminFileManagerPath,
  listAdminFileManagerDirectorySuccess,
  refreshAdminFileManager,
  setAdminFileManagerView,
  verifyAdminFileManagerFileSuccess,
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

  it('stores and clears verify results', () => {
    const withResult = adminFileManagerReducer(
      initialAdminFileManagerState,
      verifyAdminFileManagerFileSuccess({
        result: { verdict: 'authentic', contentSha256: 'a'.repeat(64) },
      }),
    );

    expect(withResult.verifyResult?.verdict).toBe('authentic');
    expect(withResult.verifyLoading).toBe(false);

    const cleared = adminFileManagerReducer(withResult, clearAdminFileManagerVerifyResult());

    expect(cleared.verifyResult).toBeNull();
    expect(cleared.verifyError).toBeNull();
  });

  it('tracks document id lookup loading success and failure', () => {
    const loading = adminFileManagerReducer(
      initialAdminFileManagerState,
      downloadAdminFileManagerByDocumentId({ documentId: 'abcdef1' }),
    );

    expect(loading.documentIdLookupLoading).toBe(true);
    expect(loading.documentIdLookupError).toBeNull();
    expect(loading.documentIdLookupSuccess).toBe(false);

    const success = adminFileManagerReducer(loading, downloadAdminFileManagerByDocumentIdSuccess());

    expect(success.documentIdLookupLoading).toBe(false);
    expect(success.documentIdLookupSuccess).toBe(true);

    const failure = adminFileManagerReducer(
      loading,
      downloadAdminFileManagerByDocumentIdFailure({ error: 'No file found' }),
    );

    expect(failure.documentIdLookupLoading).toBe(false);
    expect(failure.documentIdLookupError).toBe('No file found');
    expect(failure.documentIdLookupSuccess).toBe(false);

    const cleared = adminFileManagerReducer(failure, clearAdminFileManagerDocumentIdLookup());

    expect(cleared.documentIdLookupError).toBeNull();
    expect(cleared.documentIdLookupSuccess).toBe(false);
  });
});
