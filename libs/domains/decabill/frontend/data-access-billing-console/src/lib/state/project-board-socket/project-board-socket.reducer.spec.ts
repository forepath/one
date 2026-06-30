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
import { initialProjectBoardSocketState, projectBoardSocketReducer } from './project-board-socket.reducer';

describe('projectBoardSocketReducer', () => {
  it('sets connecting on connect', () => {
    const state = projectBoardSocketReducer(initialProjectBoardSocketState, connectProjectBoardSocket());

    expect(state.connecting).toBe(true);
  });

  it('sets connected on success', () => {
    const state = projectBoardSocketReducer(
      { ...initialProjectBoardSocketState, connecting: true },
      connectProjectBoardSocketSuccess(),
    );

    expect(state.connected).toBe(true);
    expect(state.connecting).toBe(false);
  });

  it('stores connect failure', () => {
    const state = projectBoardSocketReducer(
      { ...initialProjectBoardSocketState, connecting: true },
      connectProjectBoardSocketFailure({ error: 'failed' }),
    );

    expect(state.connected).toBe(false);
    expect(state.error).toBe('failed');
  });

  it('resets on disconnect', () => {
    const connected = {
      ...initialProjectBoardSocketState,
      connected: true,
      selectedProjectId: 'p-1',
    };
    const disconnecting = projectBoardSocketReducer(connected, disconnectProjectBoardSocket());
    const reset = projectBoardSocketReducer(disconnecting, disconnectProjectBoardSocketSuccess());

    expect(disconnecting).toEqual(initialProjectBoardSocketState);
    expect(reset).toEqual(initialProjectBoardSocketState);
  });

  it('tracks reconnect attempts', () => {
    const state = projectBoardSocketReducer(
      initialProjectBoardSocketState,
      projectBoardSocketReconnecting({ attempt: 2 }),
    );

    expect(state.reconnectAttempt).toBe(2);
  });

  it('clears reconnect state on reconnected', () => {
    const state = projectBoardSocketReducer(
      { ...initialProjectBoardSocketState, reconnectAttempt: 2, error: 'old' },
      projectBoardSocketReconnected(),
    );

    expect(state.connected).toBe(true);
    expect(state.reconnectAttempt).toBeNull();
    expect(state.error).toBeNull();
  });

  it('sets project on setProject', () => {
    const state = projectBoardSocketReducer(
      initialProjectBoardSocketState,
      setProjectBoardSocketProject({ projectId: 'p-1' }),
    );

    expect(state.selectedProjectId).toBe('p-1');
    expect(state.settingProject).toBe(true);
  });

  it('finishes setting project on success', () => {
    const state = projectBoardSocketReducer(
      { ...initialProjectBoardSocketState, settingProject: true, settingProjectId: 'p-1' },
      setProjectBoardSocketProjectSuccess({ projectId: 'p-1' }),
    );

    expect(state.settingProject).toBe(false);
    expect(state.settingProjectId).toBeNull();
  });

  it('stores socket error and clears setting flags', () => {
    const state = projectBoardSocketReducer(
      { ...initialProjectBoardSocketState, settingProject: true, settingProjectId: 'p-1' },
      projectBoardSocketError({ message: 'socket failed' }),
    );

    expect(state.error).toBe('socket failed');
    expect(state.settingProject).toBe(false);
    expect(state.settingProjectId).toBeNull();
  });
});
