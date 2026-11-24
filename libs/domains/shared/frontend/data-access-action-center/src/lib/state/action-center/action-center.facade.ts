import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateActionCenterSilence } from '../../types/action-center.types';

import {
  clearActionCenterError,
  connectActionCenter,
  disconnectActionCenter,
  loadActionCenter,
  removeActionCenterSilence,
  setActionCenterPanelOpen,
  silenceActionCenterItem,
  toggleActionCenterPanel,
} from './action-center.actions';
import {
  selectActionCenterCanSilenceForEveryone,
  selectActionCenterConnection,
  selectActionCenterError,
  selectActionCenterLoading,
  selectActionCenterOpenCount,
  selectActionCenterPanelOpen,
  selectActionCenterSaving,
  selectActionCenterSetupGroups,
  selectActionCenterSilencedGroups,
  selectActionCenterSilences,
  selectActionCenterTaskCategories,
  selectActionCenterView,
} from './action-center.selectors';

/** Entry point of the action center state for components (panel, top-bar toggle, console shells). */
@Injectable({
  providedIn: 'root',
})
export class ActionCenterFacade {
  private readonly store = inject(Store);

  readonly view$ = this.store.select(selectActionCenterView);
  readonly connection$ = this.store.select(selectActionCenterConnection);
  readonly loading$ = this.store.select(selectActionCenterLoading);
  readonly saving$ = this.store.select(selectActionCenterSaving);
  readonly error$ = this.store.select(selectActionCenterError);
  readonly panelOpen$ = this.store.select(selectActionCenterPanelOpen);
  readonly openCount$ = this.store.select(selectActionCenterOpenCount);
  readonly canSilenceForEveryone$ = this.store.select(selectActionCenterCanSilenceForEveryone);
  readonly setupGroups$ = this.store.select(selectActionCenterSetupGroups);
  readonly taskCategories$ = this.store.select(selectActionCenterTaskCategories);
  readonly silencedGroups$ = this.store.select(selectActionCenterSilencedGroups);
  readonly silences$ = this.store.select(selectActionCenterSilences);

  /** Start the live connection and load the current view (REST answers before the socket is up). */
  connect(): void {
    this.store.dispatch(connectActionCenter());
    this.store.dispatch(loadActionCenter());
  }

  disconnect(): void {
    this.store.dispatch(disconnectActionCenter());
  }

  reload(): void {
    this.store.dispatch(loadActionCenter());
  }

  setPanelOpen(open: boolean): void {
    this.store.dispatch(setActionCenterPanelOpen({ open }));
  }

  togglePanel(): void {
    this.store.dispatch(toggleActionCenterPanel());
  }

  silence(silence: CreateActionCenterSilence): void {
    this.store.dispatch(silenceActionCenterItem({ silence }));
  }

  removeSilence(silenceId: string): void {
    this.store.dispatch(removeActionCenterSilence({ silenceId }));
  }

  clearError(): void {
    this.store.dispatch(clearActionCenterError());
  }
}
