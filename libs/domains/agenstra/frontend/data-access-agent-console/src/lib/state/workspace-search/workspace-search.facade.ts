import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import * as WorkspaceSearchActions from './workspace-search.actions';
import * as WorkspaceSearchSelectors from './workspace-search.selectors';
import type { WorkspaceSearchMode } from './workspace-search.types';

@Injectable({ providedIn: 'root' })
export class WorkspaceSearchFacade {
  private readonly store = inject(Store);

  readonly query$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceSearchQuery);
  readonly mode$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceSearchMode);
  readonly includePaths$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceIncludePaths);
  readonly excludePaths$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceExcludePaths);
  readonly indexStatus$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceIndexStatus);
  readonly hits$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceSearchHits);
  readonly loading$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceSearchLoading);
  readonly error$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceSearchError);
  readonly docCount$ = this.store.select(WorkspaceSearchSelectors.selectWorkspaceSearchDocCount);

  loadStatus(clientId: string, agentId: string): void {
    this.store.dispatch(WorkspaceSearchActions.loadWorkspaceIndexStatus({ clientId, agentId }));
  }

  search(
    clientId: string,
    agentId: string,
    query: string,
    includePaths: string[],
    excludePaths: string[],
    mode: WorkspaceSearchMode,
  ): void {
    this.store.dispatch(
      WorkspaceSearchActions.searchWorkspace({ clientId, agentId, query, includePaths, excludePaths, mode }),
    );
  }

  reindex(clientId: string, agentId: string): void {
    this.store.dispatch(WorkspaceSearchActions.reindexWorkspace({ clientId, agentId }));
  }

  setQuery(query: string): void {
    this.store.dispatch(WorkspaceSearchActions.setWorkspaceSearchQuery({ query }));
  }

  setMode(mode: WorkspaceSearchMode): void {
    this.store.dispatch(WorkspaceSearchActions.setWorkspaceSearchMode({ mode }));
  }

  setIncludePaths(paths: string[]): void {
    this.store.dispatch(WorkspaceSearchActions.setWorkspaceIncludePaths({ paths }));
  }

  setExcludePaths(paths: string[]): void {
    this.store.dispatch(WorkspaceSearchActions.setWorkspaceExcludePaths({ paths }));
  }

  clearResults(): void {
    this.store.dispatch(WorkspaceSearchActions.clearWorkspaceSearchResults());
  }
}
