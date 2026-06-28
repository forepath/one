import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateProjectTimeEntryDto, UpdateProjectTimeEntryDto } from '../../types/projects.types';

import {
  createProjectTimeEntry,
  deleteProjectTimeEntry,
  loadProjectTimeEntries,
  updateProjectTimeEntry,
} from './project-time-entries.actions';
import {
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

  load(projectId: string): void {
    this.store.dispatch(loadProjectTimeEntries({ projectId }));
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
