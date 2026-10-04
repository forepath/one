import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  listAdminFileManagerDirectory,
  listAdminFileManagerDirectoryFailure,
  listAdminFileManagerDirectorySuccess,
} from './admin-file-manager.actions';
import { listAdminFileManagerDirectory$ } from './admin-file-manager.effects';
import { buildAdminFileManagerCacheKey } from './admin-file-manager.reducer';

describe('AdminFileManagerEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<Pick<AdminBillingService, 'listAdminFiles'>>;

  beforeEach(() => {
    service = {
      listAdminFiles: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: service }],
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
});
