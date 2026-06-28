import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';

import {
  connectProjectBoardSocket,
  disconnectProjectBoardSocket,
  setProjectBoardSocketProject,
} from './project-board-socket.actions';
import { getProjectBoardSocketInstance } from './project-board-socket.effects';
import { ProjectBoardSocketFacade } from './project-board-socket.facade';
import { selectProjectBoardSocketConnected, selectProjectBoardSocketState } from './project-board-socket.selectors';

jest.mock('./project-board-socket.effects', () => ({
  getProjectBoardSocketInstance: jest.fn(),
}));

describe('ProjectBoardSocketFacade', () => {
  let facade: ProjectBoardSocketFacade;
  let store: { dispatch: jest.Mock; select: jest.Mock };
  let mockSocket: { connected: boolean; emit: jest.Mock };

  beforeEach(() => {
    mockSocket = {
      connected: true,
      emit: jest.fn(),
    };
    (getProjectBoardSocketInstance as jest.Mock).mockReturnValue(mockSocket);

    store = {
      dispatch: jest.fn(),
      select: jest.fn().mockImplementation((selector: unknown) => {
        if (selector === selectProjectBoardSocketState) {
          return of({
            selectedProjectId: null,
            settingProject: false,
            settingProjectId: null,
          });
        }

        if (selector === selectProjectBoardSocketConnected) {
          return of(true);
        }

        return of(null);
      }),
    };

    TestBed.configureTestingModule({
      providers: [ProjectBoardSocketFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ProjectBoardSocketFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('connect dispatches connectProjectBoardSocket', () => {
    facade.connect();
    expect(store.dispatch).toHaveBeenCalledWith(connectProjectBoardSocket());
  });

  it('disconnect dispatches disconnectProjectBoardSocket', () => {
    facade.disconnect();
    expect(store.dispatch).toHaveBeenCalledWith(disconnectProjectBoardSocket());
  });

  it('setProject dispatches and emits when socket is connected', () => {
    facade.setProject('project-1');
    expect(store.dispatch).toHaveBeenCalledWith(setProjectBoardSocketProject({ projectId: 'project-1' }));
    expect(mockSocket.emit).toHaveBeenCalledWith('setProject', { projectId: 'project-1' });
  });

  it('setProject skips when already selected for same project', () => {
    store.select = jest.fn().mockImplementation((selector: unknown) => {
      if (selector === selectProjectBoardSocketState) {
        return of({
          selectedProjectId: 'same',
          settingProject: false,
          settingProjectId: null,
        });
      }

      if (selector === selectProjectBoardSocketConnected) {
        return of(true);
      }

      return of(null);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ProjectBoardSocketFacade, { provide: Store, useValue: store }],
    });
    TestBed.inject(ProjectBoardSocketFacade).setProject('same');
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });

  it('ensureConnectedAndSetProject dispatches connect when initially disconnected', (done) => {
    const connected$ = new BehaviorSubject(false);

    store.select = jest.fn().mockImplementation((selector: unknown) => {
      if (selector === selectProjectBoardSocketConnected) {
        return connected$.asObservable();
      }

      if (selector === selectProjectBoardSocketState) {
        return of({
          selectedProjectId: null,
          settingProject: false,
          settingProjectId: null,
        });
      }

      return of(null);
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ProjectBoardSocketFacade, { provide: Store, useValue: store }],
    });
    const f = TestBed.inject(ProjectBoardSocketFacade);

    f.ensureConnectedAndSetProject('p1').subscribe(() => {
      expect(store.dispatch).toHaveBeenCalledWith(connectProjectBoardSocket());
      expect(mockSocket.emit).toHaveBeenCalledWith('setProject', { projectId: 'p1' });
      done();
    });
    queueMicrotask(() => connected$.next(true));
  });
});
