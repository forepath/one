import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import type {
  CommitDto,
  CreateBranchDto,
  GitBranch,
  GitDiff,
  GitStatus,
  RebaseDto,
  ResolveConflictDto,
  StageFilesDto,
  UnstageFilesDto,
} from '../state/vcs/vcs.types';

@Injectable({
  providedIn: 'root',
})
export class VcsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  /**
   * Get the base URL for the API.
   */
  private get apiUrl(): string {
    return this.environment.controller.restApiUrl;
  }

  /**
   * Get git status for the agent's repository.
   */
  getStatus(clientId: string, agentId: string): Observable<GitStatus> {
    return this.http.get<GitStatus>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/status`);
  }

  /**
   * List all branches (local and remote).
   */
  getBranches(clientId: string, agentId: string): Observable<GitBranch[]> {
    return this.http.get<GitBranch[]>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches`);
  }

  /**
   * Get diff for a specific file.
   */
  getFileDiff(clientId: string, agentId: string, filePath: string): Observable<GitDiff> {
    const params = new HttpParams().set('path', filePath);

    return this.http.get<GitDiff>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/diff`, { params });
  }

  /**
   * Stage files.
   */
  stageFiles(clientId: string, agentId: string, dto: StageFilesDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/stage`, dto);
  }

  /**
   * Unstage files.
   */
  unstageFiles(clientId: string, agentId: string, dto: UnstageFilesDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/unstage`, dto);
  }

  /**
   * Commit staged changes.
   */
  commit(clientId: string, agentId: string, dto: CommitDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/commit`, dto);
  }

  /**
   * Push changes to remote.
   */
  push(clientId: string, agentId: string, options?: { force?: boolean }): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/push`, {
      force: options?.force ?? false,
    });
  }

  /**
   * Pull changes from remote.
   */
  pull(clientId: string, agentId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/pull`, {});
  }

  /**
   * Fetch changes from remote.
   */
  fetch(clientId: string, agentId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/fetch`, {});
  }

  /**
   * Rebase current branch onto another branch.
   */
  rebase(clientId: string, agentId: string, dto: RebaseDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/rebase`, dto);
  }

  /**
   * Switch to a different branch.
   */
  switchBranch(clientId: string, agentId: string, branch: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches/${encodeURIComponent(branch)}/switch`,
      {},
    );
  }

  /**
   * Create a new branch.
   */
  createBranch(clientId: string, agentId: string, dto: CreateBranchDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches`, dto);
  }

  /**
   * Delete a branch.
   */
  deleteBranch(clientId: string, agentId: string, branch: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/branches/${encodeURIComponent(branch)}`,
    );
  }

  /**
   * Resolve a merge conflict.
   */
  resolveConflict(clientId: string, agentId: string, dto: ResolveConflictDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/clients/${clientId}/agents/${agentId}/vcs/conflicts/resolve`, dto);
  }
}
