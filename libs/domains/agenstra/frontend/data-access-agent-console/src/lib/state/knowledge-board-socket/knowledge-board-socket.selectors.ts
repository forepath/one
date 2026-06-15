import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { KnowledgeBoardSocketState } from './knowledge-board-socket.reducer';

export const selectKnowledgeBoardSocketState = createFeatureSelector<KnowledgeBoardSocketState>('knowledgeBoardSocket');
export const selectKnowledgeBoardSocketConnected = createSelector(selectKnowledgeBoardSocketState, (s) => s.connected);
export const selectKnowledgeBoardSocketSelectedClientId = createSelector(
  selectKnowledgeBoardSocketState,
  (s) => s.selectedClientId,
);
export const selectKnowledgeBoardSocketSettingClient = createSelector(
  selectKnowledgeBoardSocketState,
  (s) => s.settingClient,
);
