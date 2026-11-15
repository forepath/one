import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { SubscriptionsService } from '../../services/subscriptions.service';
import type {
  ConfigChangeEligibility,
  ConfigChangePreviewResponse,
  ConfigChangeResponse,
} from '../../types/config-change.types';

import {
  loadConfigChangeEligibility,
  loadConfigChangeEligibilityFailure,
  loadConfigChangeEligibilitySuccess,
  previewConfigChange,
  previewConfigChangeFailure,
  previewConfigChangeSuccess,
  submitConfigChange,
  submitConfigChangeFailure,
  submitConfigChangeSuccess,
} from './subscription-config-change.actions';
import {
  loadConfigChangeEligibility$,
  previewConfigChange$,
  submitConfigChange$,
} from './subscription-config-change.effects';

describe('SubscriptionConfigChangeEffects', () => {
  let actions$: Actions;
  let subscriptionsService: jest.Mocked<SubscriptionsService>;
  const subscriptionId = 'sub-1';
  const mockEligibility: ConfigChangeEligibility = {
    canRequestChange: true,
    hasPendingChange: false,
    currentServerType: 'cx22',
    allowedServerTypes: ['cx22', 'cx32'],
    supportsServerTypeUpgrade: true,
    supportsServerTypeDowngrade: false,
    availableAddonIds: ['addon-2'],
    activeAddonIds: ['addon-1'],
  };
  const mockPreview: ConfigChangePreviewResponse = {
    eligibility: mockEligibility,
    amounts: {
      currency: 'EUR',
      currentPeriodNet: 10,
      newPeriodNet: 15,
      periodDeltaNet: 5,
      immediateAdjustmentNet: 2.5,
      remainingPeriodRatio: 0.5,
    },
    disclaimer: { kind: 'charge', effectiveAt: '2024-02-01T00:00:00Z', notes: [] },
    discounts: [],
  };
  const mockResult: ConfigChangeResponse = {
    id: 'run-1',
    status: 'pending',
    appliedSteps: [],
    requestedAt: '2024-01-01T00:00:00Z',
  };

  function badRequest(code: string, message: string): HttpErrorResponse {
    return new HttpErrorResponse({ status: 400, error: { statusCode: 400, message, code } });
  }

  beforeEach(() => {
    subscriptionsService = {
      getConfigChangeEligibility: jest.fn(),
      previewConfigChange: jest.fn(),
      submitConfigChange: jest.fn(),
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

  describe('loadConfigChangeEligibility$', () => {
    it('should return loadConfigChangeEligibilitySuccess on success', (done) => {
      actions$ = of(loadConfigChangeEligibility({ subscriptionId }));
      subscriptionsService.getConfigChangeEligibility.mockReturnValue(of(mockEligibility));

      loadConfigChangeEligibility$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(loadConfigChangeEligibilitySuccess({ subscriptionId, eligibility: mockEligibility }));
        done();
      });
    });

    it('should return loadConfigChangeEligibilityFailure on error', (done) => {
      actions$ = of(loadConfigChangeEligibility({ subscriptionId }));
      subscriptionsService.getConfigChangeEligibility.mockReturnValue(throwError(() => new Error('Load failed')));

      loadConfigChangeEligibility$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(loadConfigChangeEligibilityFailure({ error: 'Load failed', code: null }));
        done();
      });
    });
  });

  describe('previewConfigChange$', () => {
    it('should return previewConfigChangeSuccess on success', (done) => {
      actions$ = of(previewConfigChange({ subscriptionId, request: { serverType: 'cx32' } }));
      subscriptionsService.previewConfigChange.mockReturnValue(of(mockPreview));

      previewConfigChange$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(previewConfigChangeSuccess({ preview: mockPreview }));
        done();
      });
    });

    it('should map the backend error code into previewConfigChangeFailure', (done) => {
      actions$ = of(previewConfigChange({ subscriptionId, request: {} }));
      subscriptionsService.previewConfigChange.mockReturnValue(
        throwError(() => badRequest('CONFIG_CHANGE_NOOP', 'Nothing would change')),
      );

      previewConfigChange$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(
          previewConfigChangeFailure({ error: 'Nothing would change', code: 'CONFIG_CHANGE_NOOP' }),
        );
        done();
      });
    });
  });

  describe('submitConfigChange$', () => {
    it('should return submitConfigChangeSuccess on success', (done) => {
      actions$ = of(submitConfigChange({ subscriptionId, request: { addAddonIds: ['addon-2'] } }));
      subscriptionsService.submitConfigChange.mockReturnValue(of(mockResult));

      submitConfigChange$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(submitConfigChangeSuccess({ result: mockResult }));
        done();
      });
    });

    it('should map the backend error code into submitConfigChangeFailure', (done) => {
      actions$ = of(submitConfigChange({ subscriptionId, request: { serverType: 'cx32' } }));
      subscriptionsService.submitConfigChange.mockReturnValue(
        throwError(() => badRequest('CONFIG_CHANGE_SERVER_TYPE_LATERAL_UNSUPPORTED', 'Same price')),
      );

      submitConfigChange$(actions$, subscriptionsService).subscribe((result) => {
        expect(result).toEqual(
          submitConfigChangeFailure({ error: 'Same price', code: 'CONFIG_CHANGE_SERVER_TYPE_LATERAL_UNSUPPORTED' }),
        );
        done();
      });
    });
  });
});
