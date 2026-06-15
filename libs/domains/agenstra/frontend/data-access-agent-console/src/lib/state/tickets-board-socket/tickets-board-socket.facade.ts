import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { filter, map, Observable, switchMap, take, tap } from 'rxjs';

import {
  connectTicketsBoardSocket,
  disconnectTicketsBoardSocket,
  setTicketsBoardSocketClient,
} from './tickets-board-socket.actions';
import { getTicketsBoardSocketInstance } from './tickets-board-socket.effects';
import {
  selectTicketsBoardSocketConnected,
  selectTicketsBoardSocketConnecting,
  selectTicketsBoardSocketDisconnecting,
  selectTicketsBoardSocketError,
  selectTicketsBoardSocketSelectedClientId,
  selectTicketsBoardSocketSettingClient,
  selectTicketsBoardSocketState,
} from './tickets-board-socket.selectors';

@Injectable({
  providedIn: 'root',
})
export class TicketsBoardSocketFacade {
  private readonly store = inject(Store);

  readonly connected$: Observable<boolean> = this.store.select(selectTicketsBoardSocketConnected);
  readonly connecting$: Observable<boolean> = this.store.select(selectTicketsBoardSocketConnecting);
  readonly disconnecting$: Observable<boolean> = this.store.select(selectTicketsBoardSocketDisconnecting);
  readonly selectedClientId$: Observable<string | null> = this.store.select(selectTicketsBoardSocketSelectedClientId);
  readonly settingClient$: Observable<boolean> = this.store.select(selectTicketsBoardSocketSettingClient);
  readonly error$: Observable<string | null> = this.store.select(selectTicketsBoardSocketError);

  connect(): void {
    this.store.dispatch(connectTicketsBoardSocket());
  }

  disconnect(): void {
    this.store.dispatch(disconnectTicketsBoardSocket());
  }

  /**
   * Subscribe the tickets namespace to a workspace (server joins `client:<clientId>`).
   * No-op if the socket is not connected.
   */
  setClient(clientId: string): void {
    const socket = getTicketsBoardSocketInstance();

    if (!socket || !socket.connected) {
      console.warn('Tickets board socket not connected. Cannot set client.');

      return;
    }

    this.store
      .select(selectTicketsBoardSocketState)
      .pipe(take(1))
      .subscribe((s) => {
        if (s.selectedClientId === clientId && !s.settingClient) {
          return;
        }

        if (s.settingClient && s.settingClientId === clientId) {
          return;
        }

        this.store.dispatch(setTicketsBoardSocketClient({ clientId }));
        socket.emit('setClient', { clientId });
      });
  }

  /**
   * Ensures the tickets socket is connected, then sets the workspace context.
   */
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
