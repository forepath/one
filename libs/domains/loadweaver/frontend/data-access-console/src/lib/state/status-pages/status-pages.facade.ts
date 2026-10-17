import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateIncident, UpdateIncident } from '../../types/status-pages.types';
import {
  clearIncidentActionError,
  createIncident,
  loadIncidents,
  loadStatusPages,
  updateIncident,
} from './status-pages.actions';
import {
  selectIncidentActionError,
  selectIncidentCreating,
  selectIncidents,
  selectIncidentsError,
  selectIncidentsLoading,
  selectIncidentsProject,
  selectIncidentUpdating,
  selectOpenIncidentCount,
  selectStatusPages,
  selectStatusPagesError,
  selectStatusPagesLoading,
} from './status-pages.selectors';

@Injectable()
export class ConsoleStatusPagesFacade {
  private readonly store = inject(Store);

  readonly pages$ = this.store.select(selectStatusPages);
  readonly pagesLoading$ = this.store.select(selectStatusPagesLoading);
  readonly pagesError$ = this.store.select(selectStatusPagesError);
  readonly project$ = this.store.select(selectIncidentsProject);
  readonly incidents$ = this.store.select(selectIncidents);
  readonly incidentsLoading$ = this.store.select(selectIncidentsLoading);
  readonly incidentsError$ = this.store.select(selectIncidentsError);
  readonly openIncidents$ = this.store.select(selectOpenIncidentCount);
  readonly creating$ = this.store.select(selectIncidentCreating);
  readonly updating$ = this.store.select(selectIncidentUpdating);
  readonly actionError$ = this.store.select(selectIncidentActionError);

  loadPages(): void {
    this.store.dispatch(loadStatusPages());
  }

  loadIncidents(project: string, silent = false): void {
    this.store.dispatch(loadIncidents({ project, silent }));
  }

  createIncident(project: string, incident: CreateIncident): void {
    this.store.dispatch(createIncident({ project, incident }));
  }

  updateIncident(project: string, id: string, update: UpdateIncident): void {
    this.store.dispatch(updateIncident({ project, id, update }));
  }

  clearActionError(): void {
    this.store.dispatch(clearIncidentActionError());
  }
}
