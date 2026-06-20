import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type {
  CancelSubscriptionDto,
  CreateSubscriptionDto,
  ListParams,
  ResumeSubscriptionDto,
  SubscriptionResponse,
} from '../../types/billing.types';

import {
  cancelSubscription,
  clearSelectedSubscription,
  createSubscription,
  loadSubscription,
  loadSubscriptions,
  resumeSubscription,
} from './subscriptions.actions';
import { SubscriptionsFacade } from './subscriptions.facade';

describe('SubscriptionsFacade', () => {
  let facade: SubscriptionsFacade;
  let store: jest.Mocked<Store>;
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    store = {
      select: jest.fn(),
      dispatch: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        SubscriptionsFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(SubscriptionsFacade);
  });

  describe('State Observables', () => {
    it('should return subscriptions observable', (done) => {
      const subscriptions = [mockSubscription];

      store.select.mockReturnValue(of(subscriptions));

      facade.getSubscriptions$().subscribe((result) => {
        expect(result).toEqual(subscriptions);
        expect(store.select).toHaveBeenCalled();
        done();
      });
    });

    it('should return selected subscription observable', (done) => {
      store.select.mockReturnValue(of(mockSubscription));

      facade.getSelectedSubscription$().subscribe((result) => {
        expect(result).toEqual(mockSubscription);
        done();
      });
    });
  });

  describe('Loading State Observables', () => {
    it('should return subscriptions loading observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getSubscriptionsLoading$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return subscriptions loading any observable', (done) => {
      store.select.mockReturnValue(of(true));

      facade.getSubscriptionsLoadingAny$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Error Observable', () => {
    it('should return subscriptions error observable', (done) => {
      const error = 'Test error';

      store.select.mockReturnValue(of(error));

      facade.getSubscriptionsError$().subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });
  });

  describe('Derived State Observables', () => {
    it('should return subscriptions count observable', (done) => {
      store.select.mockReturnValue(of(2));

      facade.getSubscriptionsCount$().subscribe((result) => {
        expect(result).toBe(2);
        done();
      });
    });

    it('should return subscription by id observable', (done) => {
      store.select.mockReturnValue(of(mockSubscription));

      facade.getSubscriptionById$('sub-1').subscribe((result) => {
        expect(result).toEqual(mockSubscription);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch loadSubscriptions action', () => {
      const params: ListParams = { limit: 10, offset: 0 };

      facade.loadSubscriptions(params);

      expect(store.dispatch).toHaveBeenCalledWith(loadSubscriptions({ params }));
    });

    it('should dispatch loadSubscription action', () => {
      facade.loadSubscription('sub-1');

      expect(store.dispatch).toHaveBeenCalledWith(loadSubscription({ id: 'sub-1' }));
    });

    it('should dispatch createSubscription action', () => {
      const subscription: CreateSubscriptionDto = { planId: 'plan-1' };

      facade.createSubscription(subscription);

      expect(store.dispatch).toHaveBeenCalledWith(createSubscription({ subscription }));
    });

    it('should dispatch cancelSubscription action', () => {
      const dto: CancelSubscriptionDto = { reason: 'test' };

      facade.cancelSubscription('sub-1', dto);

      expect(store.dispatch).toHaveBeenCalledWith(cancelSubscription({ id: 'sub-1', dto }));
    });

    it('should dispatch resumeSubscription action', () => {
      const dto: ResumeSubscriptionDto = { reason: 'test' };

      facade.resumeSubscription('sub-1', dto);

      expect(store.dispatch).toHaveBeenCalledWith(resumeSubscription({ id: 'sub-1', dto }));
    });

    it('should dispatch clearSelectedSubscription action', () => {
      facade.clearSelectedSubscription();

      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedSubscription());
    });
  });
});
