import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, throwError } from 'rxjs';

import { AdminSupplierProfilesService } from '../../services/admin-supplier-profiles.service';

import {
  loadAdminSupplierProfiles,
  loadAdminSupplierProfilesFailure,
  loadAdminSupplierProfilesSuccess,
} from './admin-supplier-profiles.actions';
import { loadAdminSupplierProfiles$ } from './admin-supplier-profiles.effects';

describe('adminSupplierProfiles effects', () => {
  let actions$: Observable<unknown>;
  let service: { list: jest.Mock };

  beforeEach(() => {
    service = { list: jest.fn() };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminSupplierProfilesService, useValue: service }],
    });
  });

  it('loads exactly the requested page with the total in one request (replace-page)', (done) => {
    service.list.mockReturnValue(of({ items: [{ id: 's-1' }], total: 26, limit: 25, offset: 25 }));
    actions$ = of(loadAdminSupplierProfiles({ search: 'acme', page: 2 }));

    TestBed.runInInjectionContext(() => {
      loadAdminSupplierProfiles$(actions$ as never, service as never).subscribe((action) => {
        expect(action).toEqual(loadAdminSupplierProfilesSuccess({ profiles: [{ id: 's-1' }] as never, total: 26 }));
        expect(service.list).toHaveBeenCalledTimes(1);
        expect(service.list).toHaveBeenCalledWith({ limit: 25, offset: 25, search: 'acme' });
        done();
      });
    });
  });

  it('maps load errors', (done) => {
    service.list.mockReturnValue(throwError(() => new Error('load failed')));
    actions$ = of(loadAdminSupplierProfiles({}));

    TestBed.runInInjectionContext(() => {
      loadAdminSupplierProfiles$(actions$ as never, service as never).subscribe((action) => {
        expect(action).toEqual(loadAdminSupplierProfilesFailure({ error: 'load failed' }));
        done();
      });
    });
  });
});
