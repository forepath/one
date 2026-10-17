import { createAction, props } from '@ngrx/store';

import type { LiveTargets, TerminalSessionRecord, TunnelRecord } from '../../types/live.types';

/** Replicas, volumes and nodes for the terminal / file pickers. */
export const loadLiveTargets = createAction('[ConsoleLive] Load Targets');
export const loadLiveTargetsSuccess = createAction(
  '[ConsoleLive] Load Targets Success',
  props<{ targets: LiveTargets }>(),
);
export const loadLiveTargetsFailure = createAction('[ConsoleLive] Load Targets Failure', props<{ error: string }>());

/** Terminal session records, optionally of one project. */
export const loadTerminalSessions = createAction('[ConsoleLive] Load Sessions', props<{ project: string | null }>());
export const loadTerminalSessionsSuccess = createAction(
  '[ConsoleLive] Load Sessions Success',
  props<{ sessions: TerminalSessionRecord[] }>(),
);
export const loadTerminalSessionsFailure = createAction(
  '[ConsoleLive] Load Sessions Failure',
  props<{ error: string }>(),
);

export const loadTunnels = createAction('[ConsoleLive] Load Tunnels');
export const loadTunnelsSuccess = createAction(
  '[ConsoleLive] Load Tunnels Success',
  props<{ tunnels: TunnelRecord[] }>(),
);
export const loadTunnelsFailure = createAction('[ConsoleLive] Load Tunnels Failure', props<{ error: string }>());
