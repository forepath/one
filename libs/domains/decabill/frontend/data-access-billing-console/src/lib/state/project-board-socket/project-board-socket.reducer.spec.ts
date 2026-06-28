import {
  connectProjectBoardSocket,
  connectProjectBoardSocketSuccess,
  setProjectBoardSocketProject,
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

  it('sets project on setProject', () => {
    const state = projectBoardSocketReducer(
      initialProjectBoardSocketState,
      setProjectBoardSocketProject({ projectId: 'p-1' }),
    );

    expect(state.selectedProjectId).toBe('p-1');
    expect(state.settingProject).toBe(true);
  });
});
