import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { AlertListQuery, CreateAlertSilence } from '../../types/alerts.types';
import {
  acknowledgeAlert,
  clearAlertActionError,
  createSilence,
  endSilence,
  loadAlert,
  loadAlerts,
  loadSilences,
} from './alerts.actions';
import {
  selectAcknowledgingAlert,
  selectAlertActionError,
  selectAlertCounts,
  selectAlerts,
  selectAlertsError,
  selectAlertsLoading,
  selectAlertsQuery,
  selectEndingSilence,
  selectSelectedAlert,
  selectSelectedAlertError,
  selectSelectedAlertLoading,
  selectSilenceSaving,
  selectSilences,
  selectSilencesError,
  selectSilencesExpired,
  selectSilencesLoading,
} from './alerts.selectors';

@Injectable()
export class ConsoleAlertsFacade {
  private readonly store = inject(Store);

  readonly alerts$ = this.store.select(selectAlerts);
  readonly query$ = this.store.select(selectAlertsQuery);
  readonly loading$ = this.store.select(selectAlertsLoading);
  readonly error$ = this.store.select(selectAlertsError);
  readonly counts$ = this.store.select(selectAlertCounts);
  readonly selected$ = this.store.select(selectSelectedAlert);
  readonly selectedLoading$ = this.store.select(selectSelectedAlertLoading);
  readonly selectedError$ = this.store.select(selectSelectedAlertError);
  readonly acknowledging$ = this.store.select(selectAcknowledgingAlert);
  readonly silences$ = this.store.select(selectSilences);
  readonly silencesExpired$ = this.store.select(selectSilencesExpired);
  readonly silencesLoading$ = this.store.select(selectSilencesLoading);
  readonly silencesError$ = this.store.select(selectSilencesError);
  readonly silenceSaving$ = this.store.select(selectSilenceSaving);
  readonly endingSilence$ = this.store.select(selectEndingSilence);
  readonly actionError$ = this.store.select(selectAlertActionError);

  /** `silent`: refresh without the loading state (periodic refresh). */
  load(query: AlertListQuery, silent = false): void {
    this.store.dispatch(loadAlerts({ query, silent }));
  }

  open(id: string): void {
    this.store.dispatch(loadAlert({ id }));
  }

  acknowledge(id: string): void {
    this.store.dispatch(acknowledgeAlert({ id }));
  }

  loadSilences(expired = false): void {
    this.store.dispatch(loadSilences({ expired }));
  }

  createSilence(silence: CreateAlertSilence): void {
    this.store.dispatch(createSilence({ silence }));
  }

  endSilence(id: string): void {
    this.store.dispatch(endSilence({ id }));
  }

  clearActionError(): void {
    this.store.dispatch(clearAlertActionError());
  }
}
