import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, map, Observable, switchMap, take, tap } from 'rxjs';

import {
  connectProjectBoardSocket,
  disconnectProjectBoardSocket,
  setProjectBoardSocketProject,
} from './project-board-socket.actions';
import { getProjectBoardSocketInstance } from './project-board-socket.effects';
import {
  selectProjectBoardSocketConnected,
  selectProjectBoardSocketConnecting,
  selectProjectBoardSocketError,
  selectProjectBoardSocketSelectedProjectId,
  selectProjectBoardSocketSettingProject,
  selectProjectBoardSocketState,
} from './project-board-socket.selectors';

@Injectable()
export class ProjectBoardSocketFacade {
  private readonly store = inject(Store);

  readonly connected$ = this.store.select(selectProjectBoardSocketConnected);
  readonly connecting$ = this.store.select(selectProjectBoardSocketConnecting);
  readonly selectedProjectId$ = this.store.select(selectProjectBoardSocketSelectedProjectId);
  readonly settingProject$ = this.store.select(selectProjectBoardSocketSettingProject);
  readonly error$ = this.store.select(selectProjectBoardSocketError);

  connect(): void {
    this.store.dispatch(connectProjectBoardSocket());
  }

  disconnect(): void {
    this.store.dispatch(disconnectProjectBoardSocket());
  }

  /**
   * Subscribe the projects namespace to a project (server joins `project:<projectId>`).
   * No-op if the socket is not connected.
   */
  setProject(projectId: string): void {
    const socket = getProjectBoardSocketInstance();

    if (!socket?.connected) {
      this.store.dispatch(setProjectBoardSocketProject({ projectId }));

      return;
    }

    this.store
      .select(selectProjectBoardSocketState)
      .pipe(take(1))
      .subscribe((state) => {
        if (state.selectedProjectId === projectId && !state.settingProject) {
          return;
        }

        if (state.settingProject && state.settingProjectId === projectId) {
          return;
        }

        this.store.dispatch(setProjectBoardSocketProject({ projectId }));
        socket.emit('setProject', { projectId });
      });
  }

  /**
   * Ensures the projects socket is connected, then sets the project context.
   */
  ensureConnectedAndSetProject(projectId: string): Observable<void> {
    return this.connected$.pipe(
      take(1),
      switchMap((connected) => {
        if (!connected) {
          this.connect();

          return this.connected$.pipe(filter(Boolean), take(1));
        }

        return this.connected$.pipe(take(1));
      }),
      tap(() => this.setProject(projectId)),
      map(() => undefined),
    );
  }
}
