import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, filter, from, map, of, switchMap, withLatestFrom } from 'rxjs';

import { ForepathDeviceCapabilityService } from '../../services/forepath-device-capability.service';
import { ForepathLocalLlmService } from '../../services/forepath-local-llm.service';
import { ForepathLlmMemoryProfileService } from '../../services/forepath-llm-memory-profile.service';
import { ForepathPricingCalculatorService } from '../../services/forepath-pricing-calculator.service';
import type { LocalLlmProgress } from '../../services/forepath-local-llm.service';
import { toModelLoadErrorMessage } from '../../utils/forepath-model-assets.utils';
import {
  buildCapabilityCheckSuccessAction,
  persistMemoryProfileSelection,
  shouldAutoRequestGpuAccess,
} from '../../utils/forepath-estimator-capability.utils';
import { canSwitchToMemoryProfile, getMemoryProfileById } from '../../utils/forepath-memory-profile.utils';
import type { ChatMessage } from '../../types/project-estimator.types';

import { ProjectEstimatorActions } from './project-estimator.actions';
import { selectActiveMemoryProfileId, selectDeviceMaxMemoryProfileId } from './project-estimator.selectors';

function normalizeError(error: unknown): string {
  const friendlyModelMessage = toModelLoadErrorMessage(error);

  if (friendlyModelMessage.includes('The quote tool could not be loaded')) {
    return friendlyModelMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  return 'An unexpected error occurred while generating your quote.';
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildUserMessage(description: string): ChatMessage {
  return {
    id: createMessageId('user'),
    role: 'user',
    content: description.trim(),
    timestamp: new Date().toISOString(),
  };
}

function buildAssistantMessage(summary: string, estimate: ChatMessage['estimate']): ChatMessage {
  return {
    id: createMessageId('assistant'),
    role: 'assistant',
    content: summary,
    timestamp: new Date().toISOString(),
    estimate,
  };
}

function createThrottledProgressReporter(
  dispatch: (action: ReturnType<typeof ProjectEstimatorActions.preloadModelProgress>) => void,
): (progress: LocalLlmProgress) => void {
  let lastDispatchMs = 0;
  let lastRoundedProgress = -1;

  return (progress) => {
    const rounded = Math.round(progress.progress * 10) / 10;
    const now = Date.now();

    if (rounded === lastRoundedProgress && now - lastDispatchMs < 400) {
      return;
    }

    lastDispatchMs = now;
    lastRoundedProgress = rounded;

    dispatch(
      ProjectEstimatorActions.preloadModelProgress({
        progress: progress.progress,
        text: progress.text,
      }),
    );
  };
}

export const initializeEstimator$ = createEffect(
  (actions$ = inject(Actions), capabilityService = inject(ForepathDeviceCapabilityService)) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.initializeEstimator),
      map(() => {
        const probe = capabilityService.probeEnvironment();

        if (probe.awaitingGpuPermission) {
          if (shouldAutoRequestGpuAccess()) {
            return ProjectEstimatorActions.requestGpuAccess();
          }

          return ProjectEstimatorActions.gpuAccessRequired();
        }

        return ProjectEstimatorActions.checkDeviceCapabilitySuccess({
          supported: false,
          reason: probe.unsupportedReason,
        });
      }),
    );
  },
  { functional: true },
);

export const requestGpuAccess$ = createEffect(
  (
    actions$ = inject(Actions),
    capabilityService = inject(ForepathDeviceCapabilityService),
    memoryProfileService = inject(ForepathLlmMemoryProfileService),
  ) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.requestGpuAccess),
      switchMap(() =>
        from(capabilityService.requestGpuAccess()).pipe(
          map((result) =>
            buildCapabilityCheckSuccessAction(result, memoryProfileService, {
              persistGpuAccess: true,
              restoreSavedProfile: true,
            }),
          ),
          catchError((error) =>
            of(
              ProjectEstimatorActions.checkDeviceCapabilitySuccess({
                supported: false,
                reason: normalizeError(error),
              }),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const checkDeviceCapability$ = createEffect(
  (
    actions$ = inject(Actions),
    capabilityService = inject(ForepathDeviceCapabilityService),
    memoryProfileService = inject(ForepathLlmMemoryProfileService),
  ) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.checkDeviceCapability),
      switchMap(() =>
        from(capabilityService.checkCapability()).pipe(
          map((result) =>
            buildCapabilityCheckSuccessAction(result, memoryProfileService, {
              persistGpuAccess: true,
              restoreSavedProfile: true,
            }),
          ),
          catchError((error) =>
            of(
              ProjectEstimatorActions.checkDeviceCapabilitySuccess({
                supported: false,
                reason: normalizeError(error),
              }),
            ),
          ),
        ),
      ),
    );
  },
  { functional: true },
);

export const preloadModelAfterCapabilityCheck$ = createEffect(
  (actions$ = inject(Actions)) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.checkDeviceCapabilitySuccess),
      filter(({ supported }) => supported),
      map(() => ProjectEstimatorActions.preloadModel()),
    );
  },
  { functional: true },
);

export const preloadModel$ = createEffect(
  (
    actions$ = inject(Actions),
    localLlmService = inject(ForepathLocalLlmService),
    memoryProfileService = inject(ForepathLlmMemoryProfileService),
    store = inject(Store),
  ) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.preloadModel),
      switchMap(() =>
        from(
          localLlmService.preload(
            createThrottledProgressReporter((action) => {
              store.dispatch(action);
            }),
          ),
        ).pipe(
          map(() =>
            ProjectEstimatorActions.preloadModelSuccess({
              activeMemoryProfileId: memoryProfileService.getProfile().profileId,
            }),
          ),
          catchError((error) => of(ProjectEstimatorActions.preloadModelFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const estimateProject$ = createEffect(
  (
    actions$ = inject(Actions),
    localLlmService = inject(ForepathLocalLlmService),
    pricingCalculator = inject(ForepathPricingCalculatorService),
  ) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.submitProjectDescription),
      switchMap(({ description }) => {
        const trimmedDescription = description.trim();

        if (trimmedDescription.length === 0) {
          return of(ProjectEstimatorActions.estimateProjectFailure({ error: 'Please describe your project first.' }));
        }

        return from(localLlmService.generateBreakdown(trimmedDescription)).pipe(
          map((breakdown) => {
            const estimate = pricingCalculator.calculateEstimate(breakdown);
            const userMessage = buildUserMessage(trimmedDescription);
            const assistantMessage = buildAssistantMessage(breakdown.summary, estimate);

            return ProjectEstimatorActions.estimateProjectSuccess({
              userMessage,
              assistantMessage,
              estimate,
            });
          }),
          catchError((error) => of(ProjectEstimatorActions.estimateProjectFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const changeMemoryProfile$ = createEffect(
  (
    actions$ = inject(Actions),
    store = inject(Store),
    memoryProfileService = inject(ForepathLlmMemoryProfileService),
    localLlmService = inject(ForepathLocalLlmService),
  ) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.changeMemoryProfile),
      withLatestFrom(store.select(selectActiveMemoryProfileId), store.select(selectDeviceMaxMemoryProfileId)),
      switchMap(([{ profileId }, activeProfileId, deviceMaxProfileId]) => {
        if (!activeProfileId || !deviceMaxProfileId) {
          return of(
            ProjectEstimatorActions.preloadModelFailure({
              error: 'The quote tool is not ready yet. Please wait a moment and try again.',
            }),
          );
        }

        if (!canSwitchToMemoryProfile(profileId, activeProfileId, deviceMaxProfileId)) {
          return of(
            ProjectEstimatorActions.preloadModelFailure({
              error: 'This analysis setting is not available on your device.',
            }),
          );
        }

        memoryProfileService.setProfile(getMemoryProfileById(profileId));
        persistMemoryProfileSelection(profileId);

        return from(localLlmService.unload()).pipe(
          map(() => ProjectEstimatorActions.preloadModel()),
          catchError(() => of(ProjectEstimatorActions.preloadModel())),
        );
      }),
    );
  },
  { functional: true },
);

export const reloadLocalModelAfterStartOver$ = createEffect(
  (actions$ = inject(Actions), localLlmService = inject(ForepathLocalLlmService)) => {
    return actions$.pipe(
      ofType(ProjectEstimatorActions.startOver),
      switchMap(() =>
        from(localLlmService.unload()).pipe(
          map(() => ProjectEstimatorActions.preloadModel()),
          catchError(() => of(ProjectEstimatorActions.preloadModel())),
        ),
      ),
    );
  },
  { functional: true },
);
