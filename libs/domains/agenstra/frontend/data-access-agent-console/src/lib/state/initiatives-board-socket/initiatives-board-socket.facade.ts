import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, map, Observable, switchMap, take, tap } from 'rxjs';

import {
  connectInitiativesBoardSocket,
  disconnectInitiativesBoardSocket,
  setInitiativesBoardSocketClient,
} from './initiatives-board-socket.actions';
import { getInitiativesBoardSocketInstance } from './initiatives-board-socket.effects';
import {
  selectInitiativesBoardSocketConnected,
  selectInitiativesBoardSocketSelectedClientId,
  selectInitiativesBoardSocketSettingClient,
  selectInitiativesBoardSocketState,
} from './initiatives-board-socket.selectors';

@Injectable({
  providedIn: 'root',
})
export class InitiativesBoardSocketFacade {
  private readonly store = inject(Store);

  readonly connected$: Observable<boolean> = this.store.select(selectInitiativesBoardSocketConnected);
  readonly selectedClientId$: Observable<string | null> = this.store.select(
    selectInitiativesBoardSocketSelectedClientId,
  );
  readonly settingClient$: Observable<boolean> = this.store.select(selectInitiativesBoardSocketSettingClient);

  connect(): void {
    this.store.dispatch(connectInitiativesBoardSocket());
  }

  disconnect(): void {
    this.store.dispatch(disconnectInitiativesBoardSocket());
  }

  setClient(clientId: string): void {
    const socket = getInitiativesBoardSocketInstance();

    if (!socket || !socket.connected) {
      return;
    }

    this.store
      .select(selectInitiativesBoardSocketState)
      .pipe(take(1))
      .subscribe((s) => {
        if (
          (s.selectedClientId === clientId && !s.settingClient) ||
          (s.settingClient && s.settingClientId === clientId)
        ) {
          return;
        }

        this.store.dispatch(setInitiativesBoardSocketClient({ clientId }));
        socket.emit('setClient', { clientId });
      });
  }

  ensureConnectedAndSetClient(clientId: string): Observable<void> {
    return this.connected$.pipe(
      take(1),
      switchMap((ok) => {
        if (!ok) {
          this.connect();

          return this.connected$.pipe(filter(Boolean), take(1));
        }

        return this.connected$.pipe(take(1));
      }),
      tap(() => this.setClient(clientId)),
      map(() => undefined),
    );
  }
}
