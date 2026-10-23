import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

import type {
  AccessImportResult,
  ClusterMember,
  CrossProjectRequest,
  ProjectMember,
  ProjectSettings,
  ProjectSettingsPatch,
} from '../types/access-management.types';
import type { ClusterRole, ProjectRole } from '../types/console.types';
import { ConsoleApi } from './console-api';

/**
 * Access management (3.17): cluster and project memberships, project settings and cross-project acceptances change
 * immediately (never through plan / apply); access can be exported / imported as YAML (cluster admins).
 */
@Injectable({ providedIn: 'root' })
export class AccessManagementService extends ConsoleApi {
  private readonly http = inject(HttpClient);

  clusterMembers(): Observable<ClusterMember[]> {
    return this.http.get<ClusterMember[]>(this.url('/cluster/members'));
  }

  setClusterMember(userId: string, role: ClusterRole): Observable<void> {
    return this.http.put<void>(this.url(`/cluster/members/${encodeURIComponent(userId)}`), { role });
  }

  removeClusterMember(userId: string): Observable<void> {
    return this.http.delete<void>(this.url(`/cluster/members/${encodeURIComponent(userId)}`));
  }

  members(project: string): Observable<ProjectMember[]> {
    return this.http.get<ProjectMember[]>(this.url(`/projects/${encodeURIComponent(project)}/members`));
  }

  setMember(project: string, userId: string, role: ProjectRole): Observable<void> {
    return this.http.put<void>(
      this.url(`/projects/${encodeURIComponent(project)}/members/${encodeURIComponent(userId)}`),
      { role },
    );
  }

  removeMember(project: string, userId: string): Observable<void> {
    return this.http.delete<void>(
      this.url(`/projects/${encodeURIComponent(project)}/members/${encodeURIComponent(userId)}`),
    );
  }

  settings(project: string): Observable<ProjectSettings> {
    return this.http.get<ProjectSettings>(this.url(`/projects/${encodeURIComponent(project)}/settings`));
  }

  updateSettings(project: string, patch: ProjectSettingsPatch): Observable<ProjectSettings> {
    return this.http.put<ProjectSettings>(this.url(`/projects/${encodeURIComponent(project)}/settings`), patch);
  }

  requests(project: string): Observable<CrossProjectRequest[]> {
    return this.http.get<CrossProjectRequest[]>(this.url(`/projects/${encodeURIComponent(project)}/requests`));
  }

  /** Accepts another project's policy into `project`, bound to its exact spec (operators / admins). */
  accept(project: string, request: Pick<CrossProjectRequest, 'project' | 'policy' | 'specHash'>): Observable<void> {
    return this.http.post<void>(this.url(`/projects/${encodeURIComponent(project)}/acceptances`), {
      project: request.project,
      policy: request.policy,
      specHash: request.specHash,
    });
  }

  /** Every membership and setting as YAML (cluster admins). */
  exportAccess(): Observable<string> {
    return this.http.get(this.url('/access/export'), { responseType: 'text' });
  }

  importAccess(yaml: string): Observable<AccessImportResult> {
    return this.http.post<AccessImportResult>(this.url('/access/import'), { yaml });
  }
}
