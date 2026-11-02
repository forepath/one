import { createFeatureSelector, createSelector } from '@ngrx/store';

import {
  ACTIVE_ROLLOUT_STATUSES,
  type ReleaseChannel,
  type Rollout,
  type RolloutStep,
  type UpdateRelease,
} from '../../types/updates.types';
import type { ConsoleUpdatesState } from './updates.reducer';

export const selectConsoleUpdatesState = createFeatureSelector<ConsoleUpdatesState>('consoleUpdates');

export const selectUpdatesStatus = createSelector(selectConsoleUpdatesState, (state) => state.status);
export const selectUpdateReleases = createSelector(selectConsoleUpdatesState, (state) => state.releases);
export const selectRollouts = createSelector(selectConsoleUpdatesState, (state) => state.rollouts);
export const selectMaintenanceWindows = createSelector(selectConsoleUpdatesState, (state) => state.windows);
export const selectClusterResourceName = createSelector(selectConsoleUpdatesState, (state) => state.clusterResource);
export const selectUpdatesLoaded = createSelector(selectConsoleUpdatesState, (state) => state.loaded);
export const selectUpdatesLoading = createSelector(selectConsoleUpdatesState, (state) => state.loading);
export const selectUpdatesError = createSelector(selectConsoleUpdatesState, (state) => state.error);
export const selectSelectedRollout = createSelector(selectConsoleUpdatesState, (state) => state.selected);
export const selectSelectedRolloutLoading = createSelector(selectConsoleUpdatesState, (state) => state.selectedLoading);
export const selectSelectedRolloutError = createSelector(selectConsoleUpdatesState, (state) => state.selectedError);
export const selectDownloadingReleases = createSelector(selectConsoleUpdatesState, (state) => state.downloading);
export const selectDownloadError = createSelector(selectConsoleUpdatesState, (state) => state.downloadError);
export const selectBundleUpload = createSelector(selectConsoleUpdatesState, (state) => state.upload);
export const selectBundleUploadError = createSelector(selectConsoleUpdatesState, (state) => state.uploadError);
export const selectUploadedRelease = createSelector(selectConsoleUpdatesState, (state) => state.uploaded);
export const selectCreatingRollout = createSelector(selectConsoleUpdatesState, (state) => state.creating);
export const selectCreateRolloutError = createSelector(selectConsoleUpdatesState, (state) => state.createError);
export const selectRolloutActing = createSelector(selectConsoleUpdatesState, (state) => state.acting);
export const selectRolloutActionError = createSelector(selectConsoleUpdatesState, (state) => state.actionError);

export function isRolloutActive(rollout: Pick<Rollout, 'status'> | null | undefined): boolean {
  return !!rollout && ACTIVE_ROLLOUT_STATUSES.includes(rollout.status);
}

/** Releases per channel (newest first, as the API sorts them). */
export const selectReleasesByChannel = createSelector(
  selectUpdateReleases,
  (releases): Record<ReleaseChannel, UpdateRelease[]> => ({
    stable: releases.filter((r) => r.channel !== 'beta'),
    beta: releases.filter((r) => r.channel === 'beta'),
  }),
);

/** Releases an update plan can target: imported bundles (`available`). */
export const selectPlannableReleases = createSelector(selectUpdateReleases, (releases) =>
  releases.filter((r) => r.status === 'available'),
);

/** Something changes on its own: a rollout in progress or a bundle import running (the console polls faster). */
export const selectUpdatesBusy = createSelector(
  selectUpdatesStatus,
  selectRollouts,
  selectUpdateReleases,
  (status, rollouts, releases) =>
    !!status?.activeRollout || rollouts.some(isRolloutActive) || releases.some((r) => r.status === 'importing'),
);

export interface RolloutWave {
  wave: number;
  phase: string;
  steps: RolloutStep[];
  /** Done / skipped steps of the wave. */
  done: number;
  risk: string[];
}

/** The selected rollout's steps grouped by wave (in order), each with the wave's failure analysis. */
export const selectSelectedRolloutWaves = createSelector(selectSelectedRollout, (rollout) =>
  rollout ? rolloutWaves(rollout) : [],
);

export function rolloutWaves(rollout: Pick<Rollout, 'steps' | 'failureAnalysis'>): RolloutWave[] {
  const waves = new Map<number, RolloutStep[]>();

  for (const step of [...rollout.steps].sort((a, b) => a.index - b.index))
    waves.set(step.wave, [...(waves.get(step.wave) ?? []), step]);

  for (const analysis of rollout.failureAnalysis) if (!waves.has(analysis.wave)) waves.set(analysis.wave, []);

  return [...waves.entries()]
    .sort(([a], [b]) => a - b)
    .map(([wave, steps]) => ({
      wave,
      phase: steps[0]?.phase ?? (wave === 0 ? 'control-plane' : wave === 1 ? 'canary' : 'wave'),
      steps,
      done: steps.filter((s) => s.state === 'done' || s.state === 'skipped').length,
      risk: rollout.failureAnalysis.find((a) => a.wave === wave)?.risk ?? [],
    }));
}
