import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of, throwError, toArray } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  listAdminFileManagerDirectory,
  listAdminFileManagerDirectoryFailure,
  listAdminFileManagerDirectorySuccess,
  refreshAdminFileManager,
} from './admin-file-manager.actions';
import { listAdminFileManagerDirectory$, refreshAdminFileManager$ } from './admin-file-manager.effects';
import { buildAdminFileManagerCacheKey, initialAdminFileManagerState } from './admin-file-manager.reducer';
import { selectAdminFileManagerState } from './admin-file-manager.selectors';

describe('AdminFileManagerEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<Pick<AdminBillingService, 'listAdminFiles'>>;

  beforeEach(() => {
    service = {
      listAdminFiles: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        provideMockStore({
          initialState: {
            adminFileManager: {
              ...initialAdminFileManagerState,
              view: 'tenant',
              viewTenantId: 'default',
              expandedPaths: ['', 'customer', 'customer/invoices'],
            },
          },
        }),
        { provide: AdminBillingService, useValue: service },
      ],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('lists directories on success', (done) => {
    actions$ = of(listAdminFileManagerDirectory({ params: { path: '', view: 'tenant', viewTenantId: 'default' } }));
    service.listAdminFiles.mockReturnValue(
      of({
        path: '',
        view: 'tenant',
        viewTenantId: 'default',
        entries: [{ name: 'invoices', path: 'invoices', type: 'directory' }],
      }),
    );

    listAdminFileManagerDirectory$(actions$, service as AdminBillingService).subscribe((result) => {
      expect(result).toEqual(
        listAdminFileManagerDirectorySuccess({
          cacheKey: buildAdminFileManagerCacheKey('tenant', 'default', ''),
          path: '',
          view: 'tenant',
          viewTenantId: 'default',
          entries: [{ name: 'invoices', path: 'invoices', type: 'directory' }],
        }),
      );
      done();
    });
  });

  it('maps list failures', (done) => {
    actions$ = of(listAdminFileManagerDirectory({ params: { path: '' } }));
    service.listAdminFiles.mockReturnValue(throwError(() => new Error('boom')));

    listAdminFileManagerDirectory$(actions$, service as AdminBillingService).subscribe((result) => {
      expect(result).toEqual(listAdminFileManagerDirectoryFailure({ error: 'boom' }));
      done();
    });
  });

  it('relists expanded paths on refresh in depth order', (done) => {
    const store = TestBed.inject(MockStore);

    store.overrideSelector(selectAdminFileManagerState, {
      ...initialAdminFileManagerState,
      view: 'tenant',
      viewTenantId: 'default',
      expandedPaths: ['customer/invoices', '', 'customer'],
    });
    store.refreshState();

    actions$ = of(refreshAdminFileManager());

    refreshAdminFileManager$(actions$, store)
      .pipe(toArray())
      .subscribe((results) => {
        expect(results).toEqual([
          listAdminFileManagerDirectory({ params: { path: '', view: 'tenant', viewTenantId: 'default' } }),
          listAdminFileManagerDirectory({ params: { path: 'customer', view: 'tenant', viewTenantId: 'default' } }),
          listAdminFileManagerDirectory({
            params: { path: 'customer/invoices', view: 'tenant', viewTenantId: 'default' },
          }),
        ]);
        done();
      });
  });
});
