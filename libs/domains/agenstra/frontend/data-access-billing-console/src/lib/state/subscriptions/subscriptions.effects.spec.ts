import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { SubscriptionsService } from '../../services/subscriptions.service';
import type { SubscriptionResponse } from '../../types/billing.types';

import {
  cancelSubscription,
  cancelSubscriptionFailure,
  cancelSubscriptionSuccess,
  createSubscription,
  createSubscriptionFailure,
  createSubscriptionSuccess,
  loadSubscription,
  loadSubscriptionFailure,
  loadSubscriptions,
  loadSubscriptionsBatch,
  loadSubscriptionsFailure,
  loadSubscriptionsSuccess,
  loadSubscriptionSuccess,
  resumeSubscription,
  resumeSubscriptionFailure,
  resumeSubscriptionSuccess,
} from './subscriptions.actions';
import {
  cancelSubscription$,
  createSubscription$,
  loadSubscription$,
  loadSubscriptions$,
  loadSubscriptionsBatch$,
  resumeSubscription$,
} from './subscriptions.effects';

describe('SubscriptionsEffects', () => {
  let actions$: Actions;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  const mockSubscription: SubscriptionResponse = {
    id: 'sub-1',
    planId: 'plan-1',
    userId: 'user-1',
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    subscriptionsService = {
      listSubscriptions: jest.fn(),
      getSubscription: jest.fn(),
      createSubscription: jest.fn(),
      cancelSubscription: jest.fn(),
      resumeSubscription: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        {
          provide: SubscriptionsService,
          useValue: subscriptionsService,
        },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  describe('loadSubscriptions$', () => {
    it('should return loadSubscriptionsSuccess when batch is empty', (done) => {
      const action = loadSubscriptions({ params: {} });
      const outcome = loadSubscriptionsSuccess({ subscriptions: [] });

      actions$ = of(action);
      subscriptionsService.listSubscriptions.mockReturnValue(of([]));

      loadSubscriptions$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        expect(subscriptionsService.listSubscriptions).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 10, offset: 0 }),
        );
        done();
      });
    });

    it('should return loadSubscriptionsSuccess when batch is partial', (done) => {
      const subscriptions = [mockSubscription];
      const action = loadSubscriptions({ params: {} });
      const outcome = loadSubscriptionsSuccess({ subscriptions });

      actions$ = of(action);
      subscriptionsService.listSubscriptions.mockReturnValue(of(subscriptions));

      loadSubscriptions$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadSubscriptionsFailure on error', (done) => {
      const action = loadSubscriptions({ params: {} });
      const error = new Error('Load failed');
      const outcome = loadSubscriptionsFailure({ error: 'Load failed' });

      actions$ = of(action);
      subscriptionsService.listSubscriptions.mockReturnValue(throwError(() => error));

      loadSubscriptions$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadSubscriptionsBatch$', () => {
    it('should return loadSubscriptionsSuccess when batch is empty', (done) => {
      const accumulatedSubscriptions = [mockSubscription];
      const action = loadSubscriptionsBatch({ offset: 10, accumulatedSubscriptions });
      const outcome = loadSubscriptionsSuccess({ subscriptions: accumulatedSubscriptions });

      actions$ = of(action);
      subscriptionsService.listSubscriptions.mockReturnValue(of([]));

      loadSubscriptionsBatch$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadSubscriptionsFailure on error', (done) => {
      const action = loadSubscriptionsBatch({ offset: 10, accumulatedSubscriptions: [mockSubscription] });
      const outcome = loadSubscriptionsFailure({ error: 'Load failed' });

      actions$ = of(action);
      subscriptionsService.listSubscriptions.mockReturnValue(throwError(() => new Error('Load failed')));

      loadSubscriptionsBatch$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('loadSubscription$', () => {
    it('should return loadSubscriptionSuccess on success', (done) => {
      const action = loadSubscription({ id: 'sub-1' });
      const outcome = loadSubscriptionSuccess({ subscription: mockSubscription });

      actions$ = of(action);
      subscriptionsService.getSubscription.mockReturnValue(of(mockSubscription));

      loadSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return loadSubscriptionFailure on error', (done) => {
      const action = loadSubscription({ id: 'sub-1' });
      const outcome = loadSubscriptionFailure({ error: 'Load failed' });

      actions$ = of(action);
      subscriptionsService.getSubscription.mockReturnValue(throwError(() => new Error('Load failed')));

      loadSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('createSubscription$', () => {
    it('should return createSubscriptionSuccess on success', (done) => {
      const createDto = { planId: 'plan-1' };
      const action = createSubscription({ subscription: createDto });
      const outcome = createSubscriptionSuccess({ subscription: mockSubscription });

      actions$ = of(action);
      subscriptionsService.createSubscription.mockReturnValue(of(mockSubscription));

      createSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return createSubscriptionFailure on error', (done) => {
      const action = createSubscription({ subscription: { planId: 'plan-1' } });
      const outcome = createSubscriptionFailure({ error: 'Create failed' });

      actions$ = of(action);
      subscriptionsService.createSubscription.mockReturnValue(throwError(() => new Error('Create failed')));

      createSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('cancelSubscription$', () => {
    it('should return cancelSubscriptionSuccess on success', (done) => {
      const action = cancelSubscription({ id: 'sub-1' });
      const outcome = cancelSubscriptionSuccess({ subscription: mockSubscription });

      actions$ = of(action);
      subscriptionsService.cancelSubscription.mockReturnValue(of(mockSubscription));

      cancelSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return cancelSubscriptionFailure on error', (done) => {
      const action = cancelSubscription({ id: 'sub-1' });
      const outcome = cancelSubscriptionFailure({ error: 'Cancel failed' });

      actions$ = of(action);
      subscriptionsService.cancelSubscription.mockReturnValue(throwError(() => new Error('Cancel failed')));

      cancelSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });

  describe('resumeSubscription$', () => {
    it('should return resumeSubscriptionSuccess on success', (done) => {
      const action = resumeSubscription({ id: 'sub-1' });
      const outcome = resumeSubscriptionSuccess({ subscription: mockSubscription });

      actions$ = of(action);
      subscriptionsService.resumeSubscription.mockReturnValue(of(mockSubscription));

      resumeSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });

    it('should return resumeSubscriptionFailure on error', (done) => {
      const action = resumeSubscription({ id: 'sub-1' });
      const outcome = resumeSubscriptionFailure({ error: 'Resume failed' });

      actions$ = of(action);
      subscriptionsService.resumeSubscription.mockReturnValue(throwError(() => new Error('Resume failed')));

      resumeSubscription$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(outcome);
        done();
      });
    });
  });
});
