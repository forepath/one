import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { BillingDashboardSocketState } from './billing-dashboard-socket.reducer';

const selectBillingDashboardSocketState = createFeatureSelector<BillingDashboardSocketState>('billingDashboardSocket');

export const selectBillingDashboardSocketConnecting = createSelector(
  selectBillingDashboardSocketState,
  (state) => state.connecting,
);

export const selectBillingDashboardSocketConnected = createSelector(
  selectBillingDashboardSocketState,
  (state) => state.connected,
);

export const selectBillingDashboardSocketAwaitingFirstUpdate = createSelector(
  selectBillingDashboardSocketState,
  (state) => state.awaitingFirstUpdate,
);

export const selectBillingDashboardSocketError = createSelector(
  selectBillingDashboardSocketState,
  (state) => state.error,
);

export const selectBillingDashboardStreamPending = createSelector(
  selectBillingDashboardSocketConnecting,
  selectBillingDashboardSocketConnected,
  selectBillingDashboardSocketAwaitingFirstUpdate,
  (connecting, connected, awaitingFirstUpdate) => connecting || (connected && awaitingFirstUpdate),
);
