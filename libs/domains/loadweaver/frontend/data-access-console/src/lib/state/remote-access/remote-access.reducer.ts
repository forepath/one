import { createReducer, on } from '@ngrx/store';

import type { VpnClient } from '../../types/remote-access.types';
import {
  loadDevices,
  loadDevicesFailure,
  loadDevicesSuccess,
  revokeDevice,
  revokeDeviceFailure,
  revokeDeviceSuccess,
} from './remote-access.actions';

export interface ConsoleRemoteAccessState {
  devices: VpnClient[];
  /** The list shows every client (admins), not only the caller's. */
  all: boolean;
  loading: boolean;
  error: string | null;
  revoking: string | null;
  revokeError: string | null;
}

export const initialConsoleRemoteAccessState: ConsoleRemoteAccessState = {
  devices: [],
  all: false,
  loading: false,
  error: null,
  revoking: null,
  revokeError: null,
};

export const consoleRemoteAccessReducer = createReducer(
  initialConsoleRemoteAccessState,
  on(loadDevices, (state, { all, silent }) => ({
    ...state,
    all,
    devices: state.all === all ? state.devices : [],
    loading: !silent,
    error: null,
  })),
  on(loadDevicesSuccess, (state, { all, devices }) =>
    state.all === all ? { ...state, devices, loading: false } : state,
  ),
  on(loadDevicesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(revokeDevice, (state, { id }) => ({ ...state, revoking: id, revokeError: null })),
  on(revokeDeviceSuccess, (state, { id, revokedAt }) => ({
    ...state,
    revoking: null,
    devices: state.devices.map((d) => (d.id === id ? { ...d, status: 'revoked' as const, revokedAt } : d)),
  })),
  on(revokeDeviceFailure, (state, { error }) => ({ ...state, revoking: null, revokeError: error })),
);
