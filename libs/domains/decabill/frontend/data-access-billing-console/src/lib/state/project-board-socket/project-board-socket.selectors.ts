import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectBoardSocketState } from './project-board-socket.reducer';

export const selectProjectBoardSocketState = createFeatureSelector<ProjectBoardSocketState>('projectBoardSocket');

export const selectProjectBoardSocketConnected = createSelector(selectProjectBoardSocketState, (s) => s.connected);
export const selectProjectBoardSocketConnecting = createSelector(selectProjectBoardSocketState, (s) => s.connecting);
export const selectProjectBoardSocketSelectedProjectId = createSelector(
  selectProjectBoardSocketState,
  (s) => s.selectedProjectId,
);
export const selectProjectBoardSocketSettingProject = createSelector(
  selectProjectBoardSocketState,
  (s) => s.settingProject,
);
export const selectProjectBoardSocketError = createSelector(selectProjectBoardSocketState, (s) => s.error);
