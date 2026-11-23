import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import type { AdminOverviewResponse } from '../../types/admin-overview.types';

import { loadAdminOverview, loadAdminOverviewFailure, loadAdminOverviewSuccess } from './admin-overview.actions';
import { loadAdminOverview$ } from './admin-overview.effects';

describe('AdminOverviewEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<Pick<AdminBillingService, 'getOverview'>>;

  beforeEach(() => {
    service = { getOverview: jest.fn() };
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loads the overview with the given params', (done) => {
    const overview = { scope: 'all' } as AdminOverviewResponse;

    actions$ = of(loadAdminOverview({ params: { viewTenantId: 'all', groupBy: 'month' } }));
    service.getOverview.mockReturnValue(of(overview));

    loadAdminOverview$(actions$, service as unknown as AdminBillingService).subscribe((result) => {
      expect(service.getOverview).toHaveBeenCalledWith({ viewTenantId: 'all', groupBy: 'month' });
      expect(result).toEqual(loadAdminOverviewSuccess({ overview }));
      done();
    });
  });

  it('maps the API error message on failure', (done) => {
    actions$ = of(loadAdminOverview({ params: {} }));
    service.getOverview.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Invalid date range: from must be before to' },
          }),
      ),
    );

    loadAdminOverview$(actions$, service as unknown as AdminBillingService).subscribe((result) => {
      expect(result).toEqual(loadAdminOverviewFailure({ error: 'Invalid date range: from must be before to' }));
      done();
    });
  });

  it('falls back to the error message', (done) => {
    actions$ = of(loadAdminOverview({ params: {} }));
    service.getOverview.mockReturnValue(throwError(() => new Error('network error')));

    loadAdminOverview$(actions$, service as unknown as AdminBillingService).subscribe((result) => {
      expect(result).toEqual(loadAdminOverviewFailure({ error: 'network error' }));
      done();
    });
  });
});
