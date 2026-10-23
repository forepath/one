import { createReducer, on } from '@ngrx/store';

import type { LiveTargets, TerminalSessionRecord, TunnelRecord } from '../../types/live.types';
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

export interface ConsoleLiveState {
  targets: LiveTargets | null;
  targetsLoading: boolean;
  targetsError: string | null;
  sessions: TerminalSessionRecord[];
  sessionsProject: string | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  tunnels: TunnelRecord[];
  tunnelsLoading: boolean;
  tunnelsError: string | null;
}

export const initialConsoleLiveState: ConsoleLiveState = {
  targets: null,
  targetsLoading: false,
  targetsError: null,
  sessions: [],
  sessionsProject: null,
  sessionsLoading: false,
  sessionsError: null,
  tunnels: [],
  tunnelsLoading: false,
  tunnelsError: null,
};

export const consoleLiveReducer = createReducer(
  initialConsoleLiveState,
  on(loadLiveTargets, (state) => ({ ...state, targetsLoading: true, targetsError: null })),
  on(loadLiveTargetsSuccess, (state, { targets }) => ({ ...state, targets, targetsLoading: false })),
  on(loadLiveTargetsFailure, (state, { error }) => ({ ...state, targetsLoading: false, targetsError: error })),
  on(loadTerminalSessions, (state, { project }) => ({
    ...state,
    sessionsProject: project,
    sessions: project === state.sessionsProject ? state.sessions : [],
    sessionsLoading: true,
    sessionsError: null,
  })),
  on(loadTerminalSessionsSuccess, (state, { sessions }) => ({ ...state, sessions, sessionsLoading: false })),
  on(loadTerminalSessionsFailure, (state, { error }) => ({ ...state, sessionsLoading: false, sessionsError: error })),
  on(loadTunnels, (state) => ({ ...state, tunnelsLoading: true, tunnelsError: null })),
  on(loadTunnelsSuccess, (state, { tunnels }) => ({ ...state, tunnels, tunnelsLoading: false })),
  on(loadTunnelsFailure, (state, { error }) => ({ ...state, tunnelsLoading: false, tunnelsError: error })),
);
