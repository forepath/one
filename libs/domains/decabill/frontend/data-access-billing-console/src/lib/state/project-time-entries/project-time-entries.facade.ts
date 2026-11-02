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
  selectProjectTimeEntriesPage,
  selectProjectTimeEntriesPageSize,
  selectProjectTimeEntriesSaving,
  selectProjectTimeEntriesTotal,
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
  readonly total$ = this.store.select(selectProjectTimeEntriesTotal);
  readonly page$ = this.store.select(selectProjectTimeEntriesPage);
  readonly pageSize$ = this.store.select(selectProjectTimeEntriesPageSize);

  readonly ticketEntries$ = this.store.select(selectProjectTicketTimeEntries);
  readonly ticketLoading$ = this.store.select(selectProjectTicketTimeEntriesLoading);
  readonly ticketError$ = this.store.select(selectProjectTicketTimeEntriesError);

  /** Loads one page of the project's time entries (page 1 by default); the page replaces the current rows. */
  load(projectId: string, page?: number, pageSize?: number, search?: string): void {
    this.store.dispatch(loadProjectTimeEntries({ projectId, page, pageSize, search: search?.trim() || undefined }));
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
