import { HttpEventType } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import {
  catchError,
  concatMap,
  exhaustMap,
  filter,
  forkJoin,
  map,
  mergeMap,
  of,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';

import { ResourcesService } from '../../services/resources.service';
import { UpdatesService } from '../../services/updates.service';
import type { MaintenanceWindowSpec } from '../../types/updates.types';
import { apiErrorMessage } from '../../utils/api-error';
import {
  cancelBundleUpload,
  createRollout,
  createRolloutFailure,
  createRolloutSuccess,
  downloadRelease,
  downloadReleaseFailure,
  downloadReleaseSuccess,
  loadRollout,
  loadRolloutFailure,
  loadRolloutSuccess,
  loadUpdates,
  loadUpdatesFailure,
  loadUpdatesSuccess,
  rolloutAction,
  rolloutActionFailure,
  rolloutActionSuccess,
  uploadBundle,
  uploadBundleFailure,
  uploadBundleProgress,
  uploadBundleSuccess,
} from './updates.actions';

/**
 * Status, releases and update plans; the maintenance windows and the Cluster resource's name come from the resources
 * API and may fail on their own (e.g. a cluster role without resource access).
 */
export const loadUpdates$ = createEffect(
  (actions$ = inject(Actions), service = inject(UpdatesService), resources = inject(ResourcesService)) =>
    actions$.pipe(
      ofType(loadUpdates),
      switchMap(() =>
        forkJoin({
          status: service.status(),
          releases: service.releases(),
          rollouts: service.rollouts(),
          windows: resources.list<MaintenanceWindowSpec>('MaintenanceWindow').pipe(catchError(() => of(null))),
          clusterResource: resources.list('Cluster').pipe(
            map((list) => list[0]?.metadata.name ?? null),
            catchError(() => of(null)),
          ),
        }).pipe(
          map((loaded) => loadUpdatesSuccess(loaded)),
          catchError((error: unknown) =>
            of(loadUpdatesFailure({ error: apiErrorMessage(error, 'Failed to load updates') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadRollout$ = createEffect(
  (actions$ = inject(Actions), service = inject(UpdatesService)) =>
    actions$.pipe(
      ofType(loadRollout),
      switchMap(({ id }) =>
        service.rollout(id).pipe(
          map((rollout) => loadRolloutSuccess({ rollout })),
          catchError((error: unknown) =>
            of(loadRolloutFailure({ id, error: apiErrorMessage(error, 'Failed to load the update plan') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const downloadRelease$ = createEffect(
  (actions$ = inject(Actions), service = inject(UpdatesService)) =>
    actions$.pipe(
      ofType(downloadRelease),
      mergeMap(({ version }) =>
        service.download(version).pipe(
          map(() => downloadReleaseSuccess({ version })),
          catchError((error: unknown) =>
            of(downloadReleaseFailure({ version, error: apiErrorMessage(error, 'Failed to download the release') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Streams the bundle with upload progress; `cancelBundleUpload` aborts the request. */
export const uploadBundle$ = createEffect(
  (actions$ = inject(Actions), service = inject(UpdatesService)) =>
    actions$.pipe(
      ofType(uploadBundle),
      switchMap(({ file }) =>
        service.uploadBundle(file).pipe(
          takeUntil(actions$.pipe(ofType(cancelBundleUpload))),
          filter((event) => event.type === HttpEventType.UploadProgress || event.type === HttpEventType.Response),
          map((event) =>
            event.type === HttpEventType.UploadProgress
              ? uploadBundleProgress({ loaded: event.loaded, total: event.total ?? file.size })
              : uploadBundleSuccess({ release: event.body as NonNullable<typeof event.body> }),
          ),
          catchError((error: unknown) =>
            of(uploadBundleFailure({ error: apiErrorMessage(error, 'Failed to import the bundle') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createRollout$ = createEffect(
  (actions$ = inject(Actions), service = inject(UpdatesService)) =>
    actions$.pipe(
      ofType(createRollout),
      exhaustMap(({ request }) =>
        service.createRollout(request).pipe(
          map((rollout) => createRolloutSuccess({ rollout })),
          catchError((error: unknown) =>
            of(createRolloutFailure({ error: apiErrorMessage(error, 'Failed to plan the update') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** A new update plan is reviewed on its own page. */
export const openCreatedRollout$ = createEffect(
  (actions$ = inject(Actions), router = inject(Router)) =>
    actions$.pipe(
      ofType(createRolloutSuccess),
      tap(({ rollout }) => void router.navigate(['/delivery/updates/rollouts', rollout.id])),
    ),
  { functional: true, dispatch: false },
);

export const rolloutActions$ = createEffect(
  (actions$ = inject(Actions), service = inject(UpdatesService)) =>
    actions$.pipe(
      ofType(rolloutAction),
      concatMap(({ id, action, emergency }) =>
        service.act(id, action, !!emergency).pipe(
          map((rollout) => rolloutActionSuccess({ action, rollout })),
          catchError((error: unknown) =>
            of(rolloutActionFailure({ id, action, error: apiErrorMessage(error, `Failed to ${action} the update`) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Status, releases and plans change with downloads, imports and rollout actions. */
export const reloadUpdatesAfterChange$ = createEffect(
  (actions$ = inject(Actions)) =>
    actions$.pipe(
      ofType(downloadReleaseSuccess, uploadBundleSuccess, rolloutActionSuccess),
      map(() => loadUpdates({ silent: true })),
    ),
  { functional: true },
);
