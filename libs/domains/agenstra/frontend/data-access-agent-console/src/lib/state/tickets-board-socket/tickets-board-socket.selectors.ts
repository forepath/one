import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { TicketsBoardSocketState } from './tickets-board-socket.reducer';

export const selectTicketsBoardSocketState = createFeatureSelector<TicketsBoardSocketState>('ticketsBoardSocket');

export const selectTicketsBoardSocketConnected = createSelector(selectTicketsBoardSocketState, (s) => s.connected);

export const selectTicketsBoardSocketConnecting = createSelector(selectTicketsBoardSocketState, (s) => s.connecting);

export const selectTicketsBoardSocketDisconnecting = createSelector(
  selectTicketsBoardSocketState,
  (s) => s.disconnecting,
);

export const selectTicketsBoardSocketReconnecting = createSelector(
  selectTicketsBoardSocketState,
  (s) => s.reconnecting,
);

export const selectTicketsBoardSocketSelectedClientId = createSelector(
  selectTicketsBoardSocketState,
  (s) => s.selectedClientId,
);

export const selectTicketsBoardSocketSettingClient = createSelector(
  selectTicketsBoardSocketState,
  (s) => s.settingClient,
);

export const selectTicketsBoardSocketError = createSelector(selectTicketsBoardSocketState, (s) => s.error);
