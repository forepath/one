import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateProjectTimeEntryDto, UpdateProjectTimeEntryDto } from '../../types/projects.types';

import {
  createProjectTimeEntry,
  deleteProjectTimeEntry,
  loadProjectTimeEntries,
  loadProjectTicketTimeEntries,
  updateProjectTimeEntry,
} from './project-time-entries.actions';
import {
  selectProjectTicketTimeEntries,
  selectProjectTicketTimeEntriesError,
  selectProjectTicketTimeEntriesLoading,
  selectProjectTimeEntries,
  selectProjectTimeEntriesError,
  selectProjectTimeEntriesLoading,
  selectProjectTimeEntriesSaving,
  selectUnbilledProjectTimeEntries,
} from './project-time-entries.selectors';

@Injectable()
export class ProjectTimeEntriesFacade {
  private readonly store = inject(Store);

  readonly entries$ = this.store.select(selectProjectTimeEntries);
  readonly unbilledEntries$ = this.store.select(selectUnbilledProjectTimeEntries);
  readonly loading$ = this.store.select(selectProjectTimeEntriesLoading);
  readonly saving$ = this.store.select(selectProjectTimeEntriesSaving);
  readonly error$ = this.store.select(selectProjectTimeEntriesError);

  readonly ticketEntries$ = this.store.select(selectProjectTicketTimeEntries);
  readonly ticketLoading$ = this.store.select(selectProjectTicketTimeEntriesLoading);
  readonly ticketError$ = this.store.select(selectProjectTicketTimeEntriesError);

  load(projectId: string): void {
    this.store.dispatch(loadProjectTimeEntries({ projectId }));
  }

  loadForTicket(projectId: string, ticketId: string): void {
    this.store.dispatch(loadProjectTicketTimeEntries({ projectId, ticketId }));
  }

  create(projectId: string, dto: CreateProjectTimeEntryDto): void {
    this.store.dispatch(createProjectTimeEntry({ projectId, dto }));
  }

  update(projectId: string, id: string, dto: UpdateProjectTimeEntryDto): void {
    this.store.dispatch(updateProjectTimeEntry({ projectId, id, dto }));
  }

  remove(projectId: string, id: string): void {
    this.store.dispatch(deleteProjectTimeEntry({ projectId, id }));
  }
}
