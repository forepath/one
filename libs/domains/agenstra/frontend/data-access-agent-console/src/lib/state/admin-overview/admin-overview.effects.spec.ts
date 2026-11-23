import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { StatisticsService } from '../../services/statistics.service';

import { loadAdminOverview, loadAdminOverviewFailure, loadAdminOverviewSuccess } from './admin-overview.actions';
import { loadAdminOverview$ } from './admin-overview.effects';
import type { AdminOverviewResponse } from './admin-overview.types';

describe('AdminOverviewEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<Pick<StatisticsService, 'getAdminOverview'>>;

  beforeEach(() => {
    service = { getAdminOverview: jest.fn() };
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: StatisticsService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loads the overview with the given params', (done) => {
    const overview = { scope: 'all' } as AdminOverviewResponse;

    actions$ = of(loadAdminOverview({ params: { clientId: 'c1', groupBy: 'hour' } }));
    service.getAdminOverview.mockReturnValue(of(overview));

    loadAdminOverview$(actions$, service as unknown as StatisticsService).subscribe((result) => {
      expect(service.getAdminOverview).toHaveBeenCalledWith({ clientId: 'c1', groupBy: 'hour' });
      expect(result).toEqual(loadAdminOverviewSuccess({ overview }));
      done();
    });
  });

  it('maps the API error message on failure', (done) => {
    actions$ = of(loadAdminOverview({ params: {} }));
    service.getAdminOverview.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Invalid date range: from must be before to' },
          }),
      ),
    );

    loadAdminOverview$(actions$, service as unknown as StatisticsService).subscribe((result) => {
      expect(result).toEqual(loadAdminOverviewFailure({ error: 'Invalid date range: from must be before to' }));
      done();
    });
  });

  it('falls back to the error message', (done) => {
    actions$ = of(loadAdminOverview({ params: {} }));
    service.getAdminOverview.mockReturnValue(throwError(() => new Error('network error')));

    loadAdminOverview$(actions$, service as unknown as StatisticsService).subscribe((result) => {
      expect(result).toEqual(loadAdminOverviewFailure({ error: 'network error' }));
      done();
    });
  });
});
