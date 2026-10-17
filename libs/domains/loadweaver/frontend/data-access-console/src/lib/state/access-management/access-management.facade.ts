import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type {
  AccessExportTarget,
  CrossProjectRequest,
  ProjectSettingsPatch,
} from '../../types/access-management.types';
import type { ClusterRole, ProjectRole } from '../../types/console.types';
import {
  acceptCrossProjectRequest,
  clearAccessChangeError,
  clearAccessExport,
  clearAccessImport,
  exportAccess,
  importAccess,
  loadAccessProjects,
  loadClusterMembers,
  loadProjectAccess,
  removeClusterMember,
  removeProjectMember,
  setClusterMember,
  setProjectMember,
  updateProjectSettings,
} from './access-management.actions';
import {
  selectAccessChangeError,
  selectAccessChanging,
  selectAccessExported,
  selectAccessExportError,
  selectAccessExporting,
  selectAccessImporting,
  selectAccessImportError,
  selectAccessImportResult,
  selectAccessProject,
  selectAccessProjects,
  selectClusterMembers,
  selectClusterMembersError,
  selectClusterMembersLoading,
  selectCrossProjectRequests,
  selectOpenCrossProjectRequestCount,
  selectProjectAccess,
  selectProjectAccessError,
  selectProjectAccessLoading,
  selectProjectMembers,
} from './access-management.selectors';

/** Access management (3.17): memberships, project settings, cross-project requests, export / import. */
@Injectable()
export class ConsoleAccessManagementFacade {
  private readonly store = inject(Store);

  readonly projects$ = this.store.select(selectAccessProjects);
  readonly clusterMembers$ = this.store.select(selectClusterMembers);
  readonly clusterMembersLoading$ = this.store.select(selectClusterMembersLoading);
  readonly clusterMembersError$ = this.store.select(selectClusterMembersError);
  readonly project$ = this.store.select(selectAccessProject);
  readonly projectAccess$ = this.store.select(selectProjectAccess);
  readonly projectMembers$ = this.store.select(selectProjectMembers);
  readonly requests$ = this.store.select(selectCrossProjectRequests);
  readonly openRequestCount$ = this.store.select(selectOpenCrossProjectRequestCount);
  readonly projectLoading$ = this.store.select(selectProjectAccessLoading);
  readonly projectError$ = this.store.select(selectProjectAccessError);
  readonly changing$ = this.store.select(selectAccessChanging);
  readonly changeError$ = this.store.select(selectAccessChangeError);
  readonly exporting$ = this.store.select(selectAccessExporting);
  readonly exported$ = this.store.select(selectAccessExported);
  readonly exportError$ = this.store.select(selectAccessExportError);
  readonly importing$ = this.store.select(selectAccessImporting);
  readonly importResult$ = this.store.select(selectAccessImportResult);
  readonly importError$ = this.store.select(selectAccessImportError);

  loadProjects(): void {
    this.store.dispatch(loadAccessProjects());
  }

  loadClusterMembers(): void {
    this.store.dispatch(loadClusterMembers());
  }

  setClusterMember(userId: string, role: ClusterRole): void {
    this.store.dispatch(setClusterMember({ userId, role }));
  }

  removeClusterMember(userId: string): void {
    this.store.dispatch(removeClusterMember({ userId }));
  }

  openProject(project: string, silent = false): void {
    this.store.dispatch(loadProjectAccess({ project, silent }));
  }

  setProjectMember(project: string, userId: string, role: ProjectRole): void {
    this.store.dispatch(setProjectMember({ project, userId, role }));
  }

  removeProjectMember(project: string, userId: string): void {
    this.store.dispatch(removeProjectMember({ project, userId }));
  }

  updateSettings(project: string, patch: ProjectSettingsPatch): void {
    this.store.dispatch(updateProjectSettings({ project, patch }));
  }

  accept(project: string, request: CrossProjectRequest): void {
    this.store.dispatch(acceptCrossProjectRequest({ project, request }));
  }

  clearChangeError(): void {
    this.store.dispatch(clearAccessChangeError());
  }

  exportAccess(target: AccessExportTarget): void {
    this.store.dispatch(exportAccess({ target }));
  }

  clearExport(): void {
    this.store.dispatch(clearAccessExport());
  }

  importAccess(yaml: string): void {
    this.store.dispatch(importAccess({ yaml }));
  }

  clearImport(): void {
    this.store.dispatch(clearAccessImport());
  }
}
