import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { LiveService } from '../../services/live.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  loadLiveTargets,
  loadLiveTargetsFailure,
  loadLiveTargetsSuccess,
  loadTerminalSessions,
  loadTerminalSessionsFailure,
  loadTerminalSessionsSuccess,
  loadTunnels,
  loadTunnelsFailure,
  loadTunnelsSuccess,
} from './live.actions';

export const loadLiveTargets$ = createEffect(
  (actions$ = inject(Actions), service = inject(LiveService)) =>
    actions$.pipe(
      ofType(loadLiveTargets),
      switchMap(() =>
        service.targets().pipe(
          map((targets) => loadLiveTargetsSuccess({ targets })),
          catchError((error: unknown) =>
            of(loadLiveTargetsFailure({ error: apiErrorMessage(error, 'Failed to load replicas and volumes') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadTerminalSessions$ = createEffect(
  (actions$ = inject(Actions), service = inject(LiveService)) =>
    actions$.pipe(
      ofType(loadTerminalSessions),
      switchMap(({ project }) =>
        service.sessions(project).pipe(
          map((sessions) => loadTerminalSessionsSuccess({ sessions })),
          catchError((error: unknown) =>
            of(loadTerminalSessionsFailure({ error: apiErrorMessage(error, 'Failed to load terminal sessions') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadTunnels$ = createEffect(
  (actions$ = inject(Actions), service = inject(LiveService)) =>
    actions$.pipe(
      ofType(loadTunnels),
      switchMap(() =>
        service.tunnels().pipe(
          map((tunnels) => loadTunnelsSuccess({ tunnels })),
          catchError((error: unknown) =>
            of(loadTunnelsFailure({ error: apiErrorMessage(error, 'Failed to load tunnels') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
