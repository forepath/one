import { createReducer, on } from '@ngrx/store';

import {
  connectProjectBoardSocket,
  connectProjectBoardSocketFailure,
  connectProjectBoardSocketSuccess,
  disconnectProjectBoardSocket,
  disconnectProjectBoardSocketSuccess,
  projectBoardSocketError,
  projectBoardSocketReconnecting,
  projectBoardSocketReconnected,
  setProjectBoardSocketProject,
  setProjectBoardSocketProjectSuccess,
} from './project-board-socket.actions';

export interface ProjectBoardSocketState {
  connected: boolean;
  connecting: boolean;
  selectedProjectId: string | null;
  settingProject: boolean;
  settingProjectId: string | null;
  reconnectAttempt: number | null;
  error: string | null;
}

export const initialProjectBoardSocketState: ProjectBoardSocketState = {
  connected: false,
  connecting: false,
  selectedProjectId: null,
  settingProject: false,
  settingProjectId: null,
  reconnectAttempt: null,
  error: null,
};

export const projectBoardSocketReducer = createReducer(
  initialProjectBoardSocketState,
  on(connectProjectBoardSocket, (state) => ({ ...state, connecting: true, error: null })),
  on(connectProjectBoardSocketSuccess, projectBoardSocketReconnected, (state) => ({
    ...state,
    connected: true,
    connecting: false,
    reconnectAttempt: null,
    error: null,
  })),
  on(connectProjectBoardSocketFailure, (state, { error }) => ({
    ...state,
    connected: false,
    connecting: false,
    error,
  })),
  on(disconnectProjectBoardSocket, () => initialProjectBoardSocketState),
  on(disconnectProjectBoardSocketSuccess, () => initialProjectBoardSocketState),
  on(projectBoardSocketReconnecting, (state, { attempt }) => ({ ...state, reconnectAttempt: attempt })),
  on(setProjectBoardSocketProject, (state, { projectId }) => ({
    ...state,
    selectedProjectId: projectId,
    settingProject: true,
    settingProjectId: projectId,
    error: null,
  })),
  on(setProjectBoardSocketProjectSuccess, (state, { projectId }) => ({
    ...state,
    selectedProjectId: projectId,
    settingProject: false,
    settingProjectId: null,
    error: null,
  })),
  on(projectBoardSocketError, (state, { message }) => ({
    ...state,
    error: message,
    settingProject: false,
    settingProjectId: null,
  })),
);
