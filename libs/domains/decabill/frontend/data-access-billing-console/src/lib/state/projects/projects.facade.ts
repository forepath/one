import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type { BillProjectTimeDto, CreateAdminProjectDto, UpdateAdminProjectDto } from '../../types/projects.types';

import {
  billProjectTime,
  clearProjectsError,
  createAdminProject,
  deleteAdminProject,
  loadAdminProjectDetail,
  loadAdminProjects,
  loadProjectDetail,
  loadProjects,
  loadProjectsCatalogSummary,
  loadProjectSummary,
  updateAdminProject,
} from './projects.actions';
import {
  selectAdminProjects,
  selectAdminProjectsPage,
  selectAdminProjectsPageSize,
  selectAdminProjectsTotal,
  selectCustomerProjects,
  selectProjectSummary,
  selectProjectsBilling,
  selectProjectsCatalogSummary,
  selectProjectsCatalogSummaryLoading,
  selectProjectsCreating,
  selectProjectsDeleting,
  selectProjectsError,
  selectProjectsLoading,
  selectProjectsLoadingDetail,
  selectProjectsLoadingSummary,
  selectProjectsPage,
  selectProjectsPageSize,
  selectProjectsState,
  selectProjectsTotal,
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
  readonly catalogSummary$ = this.store.select(selectProjectsCatalogSummary);
  readonly catalogSummaryLoading$ = this.store.select(selectProjectsCatalogSummaryLoading);
  readonly loading$ = this.store.select(selectProjectsLoading);
  readonly loadingDetail$ = this.store.select(selectProjectsLoadingDetail);
  readonly loadingSummary$ = this.store.select(selectProjectsLoadingSummary);
  readonly creating$ = this.store.select(selectProjectsCreating);
  readonly updating$ = this.store.select(selectProjectsUpdating);
  readonly deleting$ = this.store.select(selectProjectsDeleting);
  readonly billing$ = this.store.select(selectProjectsBilling);
  readonly error$ = this.store.select(selectProjectsError);
  readonly total$ = this.store.select(selectProjectsTotal);
  readonly page$ = this.store.select(selectProjectsPage);
  readonly pageSize$ = this.store.select(selectProjectsPageSize);
  readonly adminTotal$ = this.store.select(selectAdminProjectsTotal);
  readonly adminPage$ = this.store.select(selectAdminProjectsPage);
  readonly adminPageSize$ = this.store.select(selectAdminProjectsPageSize);

  /** Customer projects, page 1 (or the given page); the page replaces the current rows. */
  loadProjects(params?: { search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(loadProjects({ search: params?.search, page: params?.page, pageSize: params?.pageSize }));
  }

  loadCatalogSummary(): void {
    this.store.dispatch(loadProjectsCatalogSummary());
  }

  /** Another page of the customer projects (current search, replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectProjectsState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadProjects({ search: state.customerSearch ?? undefined, page, pageSize: pageSize ?? state.pageSize }),
        ),
      );
  }

  loadProjectDetail(projectId: string): void {
    this.store.dispatch(loadProjectDetail({ projectId }));
  }

  loadProjectSummary(projectId: string): void {
    this.store.dispatch(loadProjectSummary({ projectId }));
  }

  /** Admin projects, page 1 (or the given page); the page replaces the current rows. */
  loadAdminProjects(params?: { search?: string; userId?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(loadAdminProjects(params ?? {}));
  }

  /** Another page of the admin projects (current filter, replace-page). */
  loadAdminPage(page: number, pageSize?: number): void {
    this.store
      .select(selectProjectsState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminProjects({
            search: state.adminSearch ?? undefined,
            userId: state.adminUserId ?? undefined,
            page,
            pageSize: pageSize ?? state.adminPageSize,
          }),
        ),
      );
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

  billProjectTime(projectId: string, dto: BillProjectTimeDto): void {
    this.store.dispatch(billProjectTime({ projectId, dto }));
  }

  clearError(): void {
    this.store.dispatch(clearProjectsError());
  }
}
