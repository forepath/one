import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { InitiativesBoardSocketState } from './initiatives-board-socket.reducer';

export const selectInitiativesBoardSocketState =
  createFeatureSelector<InitiativesBoardSocketState>('initiativesBoardSocket');
export const selectInitiativesBoardSocketConnected = createSelector(
  selectInitiativesBoardSocketState,
  (s) => s.connected,
);
export const selectInitiativesBoardSocketSelectedClientId = createSelector(
  selectInitiativesBoardSocketState,
  (s) => s.selectedClientId,
);
export const selectInitiativesBoardSocketSettingClient = createSelector(
  selectInitiativesBoardSocketState,
  (s) => s.settingClient,
);
