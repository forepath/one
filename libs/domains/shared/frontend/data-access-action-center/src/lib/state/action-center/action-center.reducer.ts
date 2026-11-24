import { createReducer, on } from '@ngrx/store';

import type { ActionCenterConnectionState, ActionCenterView } from '../../types/action-center.types';

import {
  actionCenterConnected,
  actionCenterConnectionLost,
  actionCenterDisconnected,
  actionCenterReconnecting,
  actionCenterSilenceFailure,
  actionCenterViewReceived,
  clearActionCenterError,
  connectActionCenter,
  disconnectActionCenter,
  loadActionCenter,
  loadActionCenterFailure,
  removeActionCenterSilence,
  setActionCenterPanelOpen,
  silenceActionCenterItem,
  toggleActionCenterPanel,
} from './action-center.actions';

export const ACTION_CENTER_FEATURE_KEY = 'actionCenter';

/** localStorage key of the panel's open state (shared by both consoles; each origin has its own storage). */
export const ACTION_CENTER_PANEL_STORAGE_KEY = 'fpc.actionCenter.open';

export interface ActionCenterState {
  view: ActionCenterView | null;
  connection: ActionCenterConnectionState;
  loading: boolean;
  /** A silence change is in flight. */
  saving: boolean;
  error: string | null;
  panelOpen: boolean;
}

function readStoredPanelOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(ACTION_CENTER_PANEL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Initial state; the panel reopens the way the user left it. */
export function createInitialActionCenterState(): ActionCenterState {
  return {
    view: null,
    connection: 'idle',
    loading: false,
    saving: false,
    error: null,
    panelOpen: readStoredPanelOpen(),
  };
}

export const actionCenterReducer = createReducer<ActionCenterState>(
  createInitialActionCenterState(),
  on(connectActionCenter, (state) => ({ ...state, connection: state.connection === 'live' ? 'live' : 'connecting' })),
  on(actionCenterConnected, (state) => ({ ...state, connection: 'live', error: null })),
  on(actionCenterReconnecting, (state) => ({ ...state, connection: 'reconnecting' })),
  on(actionCenterConnectionLost, (state) => ({ ...state, connection: 'offline' })),
  on(disconnectActionCenter, actionCenterDisconnected, (state) => ({ ...state, connection: 'idle', view: null })),
  on(loadActionCenter, (state) => ({ ...state, loading: true })),
  on(actionCenterViewReceived, (state, { view }) => {
    // A REST answer still in flight after sign-out / role loss must not bring the previous user's view back.
    if (state.connection === 'idle') {
      return { ...state, loading: false, saving: false };
    }

    // Ignore views older than the one shown (a REST answer can overtake a newer socket push).
    if (state.view && Date.parse(view.generatedAt) < Date.parse(state.view.generatedAt)) {
      return { ...state, loading: false, saving: false };
    }

    return { ...state, view, loading: false, saving: false, error: null };
  }),
  on(loadActionCenterFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(silenceActionCenterItem, removeActionCenterSilence, (state) => ({ ...state, saving: true, error: null })),
  on(actionCenterSilenceFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(setActionCenterPanelOpen, (state, { open }) => ({ ...state, panelOpen: open })),
  on(toggleActionCenterPanel, (state) => ({ ...state, panelOpen: !state.panelOpen })),
  on(clearActionCenterError, (state) => ({ ...state, error: null })),
);
