import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { PublicWithdrawalService } from '../../services/public-withdrawal.service';
import type { PublicWithdrawalAddressee } from '../../types/public-withdrawal.types';

import {
  confirmPublicWithdrawal,
  confirmPublicWithdrawalFailure,
  confirmPublicWithdrawalSuccess,
  loadPublicWithdrawalAddressee,
  loadPublicWithdrawalAddresseeFailure,
  loadPublicWithdrawalAddresseeSuccess,
  requestPublicWithdrawal,
  requestPublicWithdrawalFailure,
  requestPublicWithdrawalSuccess,
  verifyPublicWithdrawalCode,
  verifyPublicWithdrawalCodeFailure,
  verifyPublicWithdrawalCodeSuccess,
} from './public-withdrawal.actions';
import {
  confirmPublicWithdrawal$,
  loadPublicWithdrawalAddressee$,
  requestPublicWithdrawal$,
  verifyPublicWithdrawalCode$,
} from './public-withdrawal.effects';

describe('PublicWithdrawalEffects', () => {
  let actions$: Actions;
  let publicWithdrawalService: jest.Mocked<PublicWithdrawalService>;

  const mockAddressee: PublicWithdrawalAddressee = {
    name: 'Acme GmbH',
    lines: ['Example Street 1'],
  };

  beforeEach(() => {
    publicWithdrawalService = {
      getAddressee: jest.fn(),
      requestWithdrawal: jest.fn(),
      verifyCode: jest.fn(),
      confirmWithdrawal: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: PublicWithdrawalService, useValue: publicWithdrawalService },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadPublicWithdrawalAddressee$', () => {
    it('should return loadPublicWithdrawalAddresseeSuccess', (done) => {
      actions$ = of(loadPublicWithdrawalAddressee());
      publicWithdrawalService.getAddressee.mockReturnValue(of(mockAddressee));

      loadPublicWithdrawalAddressee$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(loadPublicWithdrawalAddresseeSuccess({ addressee: mockAddressee }));
        done();
      });
    });

    it('should return loadPublicWithdrawalAddresseeFailure on error', (done) => {
      actions$ = of(loadPublicWithdrawalAddressee());
      publicWithdrawalService.getAddressee.mockReturnValue(
        throwError(() => ({ error: { message: 'Service unavailable' } })),
      );

      loadPublicWithdrawalAddressee$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(loadPublicWithdrawalAddresseeFailure({ error: 'Service unavailable' }));
        done();
      });
    });
  });

  describe('requestPublicWithdrawal$', () => {
    const dto = {
      subscriptionNumber: 'SUB-000001',
      customerName: 'Jane Doe',
      email: 'jane@example.com',
      orderedOn: '2024-01-01',
    };

    it('should return requestPublicWithdrawalSuccess with resumeStep code', (done) => {
      const response = {
        requestId: 'req-1',
        resumed: false,
        resumeStep: 'code' as const,
        message: 'Check your email',
      };

      actions$ = of(requestPublicWithdrawal({ dto }));
      publicWithdrawalService.requestWithdrawal.mockReturnValue(of(response));

      requestPublicWithdrawal$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(requestPublicWithdrawalSuccess({ response }));
        done();
      });
    });

    it('should return requestPublicWithdrawalSuccess with resumeStep acknowledge', (done) => {
      const response = {
        requestId: 'req-2',
        resumed: true,
        resumeStep: 'acknowledge' as const,
        message: 'Continue where you left off',
      };

      actions$ = of(requestPublicWithdrawal({ dto }));
      publicWithdrawalService.requestWithdrawal.mockReturnValue(of(response));

      requestPublicWithdrawal$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(requestPublicWithdrawalSuccess({ response }));
        done();
      });
    });

    it('should return requestPublicWithdrawalFailure on error', (done) => {
      actions$ = of(requestPublicWithdrawal({ dto }));
      publicWithdrawalService.requestWithdrawal.mockReturnValue(throwError(() => ({ error: { message: 'No match' } })));

      requestPublicWithdrawal$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(requestPublicWithdrawalFailure({ error: 'No match' }));
        done();
      });
    });
  });

  describe('verifyPublicWithdrawalCode$', () => {
    const dto = { requestId: 'req-1', code: 'ABC123' };

    it('should return verifyPublicWithdrawalCodeSuccess', (done) => {
      actions$ = of(verifyPublicWithdrawalCode({ dto }));
      publicWithdrawalService.verifyCode.mockReturnValue(
        of({ resumeStep: 'acknowledge' as const, message: 'Verified' }),
      );

      verifyPublicWithdrawalCode$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(verifyPublicWithdrawalCodeSuccess({ message: 'Verified' }));
        done();
      });
    });

    it('should return verifyPublicWithdrawalCodeFailure on error', (done) => {
      actions$ = of(verifyPublicWithdrawalCode({ dto }));
      publicWithdrawalService.verifyCode.mockReturnValue(throwError(() => ({ error: { message: 'Invalid code' } })));

      verifyPublicWithdrawalCode$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(verifyPublicWithdrawalCodeFailure({ error: 'Invalid code' }));
        done();
      });
    });
  });

  describe('confirmPublicWithdrawal$', () => {
    const dto = { requestId: 'req-1', acknowledgeWithdrawal: true as const };

    it('should return confirmPublicWithdrawalSuccess', (done) => {
      const response = { message: 'Withdrawal submitted' };

      actions$ = of(confirmPublicWithdrawal({ dto }));
      publicWithdrawalService.confirmWithdrawal.mockReturnValue(of(response));

      confirmPublicWithdrawal$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(confirmPublicWithdrawalSuccess({ response }));
        done();
      });
    });

    it('should return confirmPublicWithdrawalFailure on error', (done) => {
      actions$ = of(confirmPublicWithdrawal({ dto }));
      publicWithdrawalService.confirmWithdrawal.mockReturnValue(
        throwError(() => ({ error: { message: 'Policy blocked' } })),
      );

      confirmPublicWithdrawal$(actions$, publicWithdrawalService).subscribe((result) => {
        expect(result).toEqual(confirmPublicWithdrawalFailure({ error: 'Policy blocked' }));
        done();
      });
    });
  });
});
