import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, map, Observable, switchMap, take, tap } from 'rxjs';

import {
  connectKnowledgeBoardSocket,
  disconnectKnowledgeBoardSocket,
  setKnowledgeBoardSocketClient,
} from './knowledge-board-socket.actions';
import { getKnowledgeBoardSocketInstance } from './knowledge-board-socket.effects';
import {
  selectKnowledgeBoardSocketConnected,
  selectKnowledgeBoardSocketSelectedClientId,
  selectKnowledgeBoardSocketSettingClient,
  selectKnowledgeBoardSocketState,
} from './knowledge-board-socket.selectors';

@Injectable({
  providedIn: 'root',
})
export class KnowledgeBoardSocketFacade {
  private readonly store = inject(Store);

  readonly connected$: Observable<boolean> = this.store.select(selectKnowledgeBoardSocketConnected);
  readonly selectedClientId$: Observable<string | null> = this.store.select(selectKnowledgeBoardSocketSelectedClientId);
  readonly settingClient$: Observable<boolean> = this.store.select(selectKnowledgeBoardSocketSettingClient);

  connect(): void {
    this.store.dispatch(connectKnowledgeBoardSocket());
  }

  disconnect(): void {
    this.store.dispatch(disconnectKnowledgeBoardSocket());
  }

  setClient(clientId: string): void {
    const socket = getKnowledgeBoardSocketInstance();

    if (!socket || !socket.connected) {
      return;
    }

    this.store
      .select(selectKnowledgeBoardSocketState)
      .pipe(take(1))
      .subscribe((s) => {
        if (
          (s.selectedClientId === clientId && !s.settingClient) ||
          (s.settingClient && s.settingClientId === clientId)
        ) {
          return;
        }

        this.store.dispatch(setKnowledgeBoardSocketClient({ clientId }));
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
