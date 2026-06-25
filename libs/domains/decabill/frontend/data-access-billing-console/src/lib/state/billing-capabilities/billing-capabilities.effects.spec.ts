import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';

import {
  loadBillingCapabilities,
  loadBillingCapabilitiesFailure,
  loadBillingCapabilitiesSuccess,
} from './billing-capabilities.actions';
import { loadBillingCapabilities$ } from './billing-capabilities.effects';

describe('BillingCapabilitiesEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<Pick<AdminBillingService, 'getCapabilities'>>;

  beforeEach(() => {
    service = {
      getCapabilities: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loads capabilities on success', (done) => {
    actions$ = of(loadBillingCapabilities());
    service.getCapabilities.mockReturnValue(of({ datevExportEnabled: true, unifiedExportAllowed: false }));

    loadBillingCapabilities$(actions$, service as AdminBillingService).subscribe((result) => {
      expect(result).toEqual(
        loadBillingCapabilitiesSuccess({ capabilities: { datevExportEnabled: true, unifiedExportAllowed: false } }),
      );
      done();
    });
  });

  it('maps load failures', (done) => {
    actions$ = of(loadBillingCapabilities());
    service.getCapabilities.mockReturnValue(throwError(() => new Error('network error')));

    loadBillingCapabilities$(actions$, service as AdminBillingService).subscribe((result) => {
      expect(result).toEqual(loadBillingCapabilitiesFailure({ error: 'network error' }));
      done();
    });
  });
});
