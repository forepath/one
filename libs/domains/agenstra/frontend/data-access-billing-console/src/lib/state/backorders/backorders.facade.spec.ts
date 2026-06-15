import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type { BackorderCancelDto, BackorderRetryDto, BackorderResponse, ListParams } from '../../types/billing.types';

import { cancelBackorder, clearSelectedBackorder, loadBackorders, retryBackorder } from './backorders.actions';
import { BackordersFacade } from './backorders.facade';

describe('BackordersFacade', () => {
  let facade: BackordersFacade;
  let store: jest.Mocked<Store>;
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
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [BackordersFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(BackordersFacade);
  });

  describe('State Observables', () => {
    it('should return backorders observable', (done) => {
      store.select.mockReturnValue(of([mockBackorder]));
      facade.getBackorders$().subscribe((result) => {
        expect(result).toEqual([mockBackorder]);
        done();
      });
    });

    it('should return selected backorder observable', (done) => {
      store.select.mockReturnValue(of(mockBackorder));
      facade.getSelectedBackorder$().subscribe((result) => {
        expect(result).toEqual(mockBackorder);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadBackorders', () => {
      const params: ListParams = { limit: 10 };

      facade.loadBackorders(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadBackorders({ params }));
    });

    it('should dispatch retryBackorder', () => {
      const dto: BackorderRetryDto = { reason: 'test' };

      facade.retryBackorder('bo-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(retryBackorder({ id: 'bo-1', dto }));
    });

    it('should dispatch cancelBackorder', () => {
      const dto: BackorderCancelDto = { reason: 'test' };

      facade.cancelBackorder('bo-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(cancelBackorder({ id: 'bo-1', dto }));
    });

    it('should dispatch clearSelectedBackorder', () => {
      facade.clearSelectedBackorder();
      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedBackorder());
    });
  });
});
