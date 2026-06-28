import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateAdminProjectDto, UpdateAdminProjectDto } from '../../types/projects.types';

import {
  billProjectTime,
  clearProjectsError,
  createAdminProject,
  deleteAdminProject,
  loadAdminProjectDetail,
  loadAdminProjects,
  loadProjectDetail,
  loadProjects,
  loadProjectSummary,
  updateAdminProject,
} from './projects.actions';
import {
  selectAdminProjects,
  selectCustomerProjects,
  selectProjectSummary,
  selectProjectsBilling,
  selectProjectsCreating,
  selectProjectsDeleting,
  selectProjectsError,
  selectProjectsLoading,
  selectProjectsLoadingDetail,
  selectProjectsLoadingSummary,
  selectProjectsUpdating,
  selectSelectedProject,
} from './projects.selectors';

@Injectable()
export class ProjectsFacade {
  private readonly store = inject(Store);

  readonly projects$ = this.store.select(selectCustomerProjects);
  readonly adminProjects$ = this.store.select(selectAdminProjects);
  readonly selectedProject$ = this.store.select(selectSelectedProject);
  readonly summary$ = this.store.select(selectProjectSummary);
  readonly loading$ = this.store.select(selectProjectsLoading);
  readonly loadingDetail$ = this.store.select(selectProjectsLoadingDetail);
  readonly loadingSummary$ = this.store.select(selectProjectsLoadingSummary);
  readonly creating$ = this.store.select(selectProjectsCreating);
  readonly updating$ = this.store.select(selectProjectsUpdating);
  readonly deleting$ = this.store.select(selectProjectsDeleting);
  readonly billing$ = this.store.select(selectProjectsBilling);
  readonly error$ = this.store.select(selectProjectsError);

  loadProjects(): void {
    this.store.dispatch(loadProjects());
  }

  loadProjectDetail(projectId: string): void {
    this.store.dispatch(loadProjectDetail({ projectId }));
  }

  loadProjectSummary(projectId: string): void {
    this.store.dispatch(loadProjectSummary({ projectId }));
  }

  loadAdminProjects(): void {
    this.store.dispatch(loadAdminProjects());
  }

  loadAdminProjectDetail(projectId: string): void {
    this.store.dispatch(loadAdminProjectDetail({ projectId }));
  }

  createAdminProject(dto: CreateAdminProjectDto): void {
    this.store.dispatch(createAdminProject({ dto }));
  }

  updateAdminProject(projectId: string, dto: UpdateAdminProjectDto): void {
    this.store.dispatch(updateAdminProject({ projectId, dto }));
  }

  deleteAdminProject(projectId: string): void {
    this.store.dispatch(deleteAdminProject({ projectId }));
  }

  billProjectTime(projectId: string, from: string, to: string): void {
    this.store.dispatch(billProjectTime({ projectId, from, to }));
  }

  clearError(): void {
    this.store.dispatch(clearProjectsError());
  }
}
