import { createReducer, on } from '@ngrx/store';

import {
  billingDashboardSocketApplicationError,
  billingDashboardSocketDataReceived,
  connectBillingDashboardSocket,
  connectBillingDashboardSocketFailure,
  connectBillingDashboardSocketSuccess,
  disconnectBillingDashboardSocket,
  disconnectBillingDashboardSocketSuccess,
} from './billing-dashboard-socket.actions';

export interface BillingDashboardSocketState {
  connecting: boolean;
  connected: boolean;
  disconnecting: boolean;
  error: string | null;
  awaitingFirstUpdate: boolean;
}

export const initialBillingDashboardSocketState: BillingDashboardSocketState = {
  connecting: false,
  connected: false,
  disconnecting: false,
  error: null,
  awaitingFirstUpdate: false,
};

export const billingDashboardSocketReducer = createReducer(
  initialBillingDashboardSocketState,
  on(connectBillingDashboardSocket, (state) => ({
    ...state,
    connecting: true,
    disconnecting: false,
    error: null,
  })),
  on(connectBillingDashboardSocketSuccess, (state) => ({
    ...state,
    connecting: false,
    connected: true,
    error: null,
    awaitingFirstUpdate: true,
  })),
  on(connectBillingDashboardSocketFailure, (state, { error }) => ({
    ...state,
    connecting: false,
    connected: false,
    error,
    awaitingFirstUpdate: false,
  })),
  on(billingDashboardSocketDataReceived, (state) => ({
    ...state,
    awaitingFirstUpdate: false,
  })),
  on(billingDashboardSocketApplicationError, (state, { message }) => ({
    ...state,
    error: message,
  })),
  on(disconnectBillingDashboardSocket, (state) => ({
    ...state,
    disconnecting: true,
  })),
  on(disconnectBillingDashboardSocketSuccess, () => initialBillingDashboardSocketState),
);
