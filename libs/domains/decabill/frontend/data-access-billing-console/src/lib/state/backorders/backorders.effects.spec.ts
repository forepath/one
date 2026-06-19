import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { BackordersService } from '../../services/backorders.service';
import type { BackorderResponse } from '../../types/billing.types';

import {
  cancelBackorder,
  cancelBackorderFailure,
  cancelBackorderSuccess,
  loadBackorders,
  loadBackordersBatch,
  loadBackordersFailure,
  loadBackordersSuccess,
  retryBackorder,
  retryBackorderFailure,
  retryBackorderSuccess,
} from './backorders.actions';
import { cancelBackorder$, loadBackorders$, loadBackordersBatch$, retryBackorder$ } from './backorders.effects';

describe('BackordersEffects', () => {
  let actions$: Actions;
  let backordersService: jest.Mocked<BackordersService>;
  const mockBackorder: BackorderResponse = {
    id: 'bo-1',
    userId: 'user-1',
    serviceTypeId: 'st-1',
    planId: 'plan-1',
    status: 'pending',
    requestedConfigSnapshot: {},
    providerErrors: {},
    preferredAlternatives: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    backordersService = {
      listBackorders: jest.fn(),
      retryBackorder: jest.fn(),
      cancelBackorder: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: BackordersService, useValue: backordersService }],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadBackorders$', () => {
    it('should return loadBackordersSuccess when batch is empty', (done) => {
      actions$ = of(loadBackorders({ params: {} }));
      backordersService.listBackorders.mockReturnValue(of([]));

      loadBackorders$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(loadBackordersSuccess({ backorders: [] }));
        done();
      });
    });

    it('should return loadBackordersFailure on error', (done) => {
      actions$ = of(loadBackorders({ params: {} }));
      backordersService.listBackorders.mockReturnValue(throwError(() => new Error('Load failed')));

      loadBackorders$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(loadBackordersFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('loadBackordersBatch$', () => {
    it('should return loadBackordersSuccess when batch is empty', (done) => {
      const accumulated = [mockBackorder];

      actions$ = of(loadBackordersBatch({ offset: 10, accumulatedBackorders: accumulated }));
      backordersService.listBackorders.mockReturnValue(of([]));

      loadBackordersBatch$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(loadBackordersSuccess({ backorders: accumulated }));
        done();
      });
    });
  });

  describe('retryBackorder$', () => {
    it('should return retryBackorderSuccess on success', (done) => {
      actions$ = of(retryBackorder({ id: 'bo-1' }));
      backordersService.retryBackorder.mockReturnValue(of(mockBackorder));

      retryBackorder$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(retryBackorderSuccess({ backorder: mockBackorder }));
        done();
      });
    });

    it('should return retryBackorderFailure on error', (done) => {
      actions$ = of(retryBackorder({ id: 'bo-1' }));
      backordersService.retryBackorder.mockReturnValue(throwError(() => new Error('Retry failed')));

      retryBackorder$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(retryBackorderFailure({ error: 'Retry failed' }));
        done();
      });
    });
  });

  describe('cancelBackorder$', () => {
    it('should return cancelBackorderSuccess on success', (done) => {
      actions$ = of(cancelBackorder({ id: 'bo-1' }));
      backordersService.cancelBackorder.mockReturnValue(of(mockBackorder));

      cancelBackorder$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(cancelBackorderSuccess({ backorder: mockBackorder }));
        done();
      });
    });

    it('should return cancelBackorderFailure on error', (done) => {
      actions$ = of(cancelBackorder({ id: 'bo-1' }));
      backordersService.cancelBackorder.mockReturnValue(throwError(() => new Error('Cancel failed')));

      cancelBackorder$(actions$, backordersService).subscribe((result) => {
        expect(result).toEqual(cancelBackorderFailure({ error: 'Cancel failed' }));
        done();
      });
    });
  });
});
