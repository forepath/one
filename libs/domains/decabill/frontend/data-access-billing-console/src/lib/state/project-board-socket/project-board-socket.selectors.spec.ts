import { initialProjectBoardSocketState } from './project-board-socket.reducer';
import {
  selectProjectBoardSocketConnected,
  selectProjectBoardSocketConnecting,
  selectProjectBoardSocketError,
  selectProjectBoardSocketSelectedProjectId,
  selectProjectBoardSocketSettingProject,
  selectProjectBoardSocketState,
} from './project-board-socket.selectors';

describe('projectBoardSocket selectors', () => {
  const rootState = {
    projectBoardSocket: {
      ...initialProjectBoardSocketState,
      connected: true,
      connecting: false,
      selectedProjectId: 'p-1',
      settingProject: true,
      error: 'socket failed',
    },
  };

  it('selects socket state fields', () => {
    expect(selectProjectBoardSocketState(rootState as never)).toEqual(rootState.projectBoardSocket);
    expect(selectProjectBoardSocketConnected(rootState as never)).toBe(true);
    expect(selectProjectBoardSocketConnecting(rootState as never)).toBe(false);
    expect(selectProjectBoardSocketSelectedProjectId(rootState as never)).toBe('p-1');
    expect(selectProjectBoardSocketSettingProject(rootState as never)).toBe(true);
    expect(selectProjectBoardSocketError(rootState as never)).toBe('socket failed');
  });
});
