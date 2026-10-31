import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import { NodesService } from '../../services/nodes.service';
import type { CreateJoinTokenRequest, NodeAction } from '../../types/nodes.types';
import {
  clearCreatedJoinToken,
  clearNodeActionError,
  createJoinToken,
  loadJoinTokens,
  loadNode,
  loadNodes,
  nodeAction,
  revokeJoinToken,
} from './nodes.actions';
import {
  selectClusterSummary,
  selectCreatedJoinToken,
  selectCreatingJoinToken,
  selectJoinTokenError,
  selectJoinTokens,
  selectJoinTokensError,
  selectJoinTokensLoading,
  selectNodeActing,
  selectNodeActionError,
  selectNodes,
  selectNodesBySite,
  selectNodesError,
  selectNodesLoading,
  selectRevokingJoinToken,
  selectSelectedNode,
  selectSelectedNodeError,
  selectSelectedNodeLoading,
} from './nodes.selectors';

@Injectable()
export class ConsoleNodesFacade {
  private readonly store = inject(Store);
  private readonly service = inject(NodesService);

  readonly nodes$ = this.store.select(selectNodes);
  readonly sites$ = this.store.select(selectNodesBySite);
  readonly cluster$ = this.store.select(selectClusterSummary);
  readonly loading$ = this.store.select(selectNodesLoading);
  readonly error$ = this.store.select(selectNodesError);
  readonly selected$ = this.store.select(selectSelectedNode);
  readonly selectedLoading$ = this.store.select(selectSelectedNodeLoading);
  readonly selectedError$ = this.store.select(selectSelectedNodeError);
  readonly acting$ = this.store.select(selectNodeActing);
  readonly actionError$ = this.store.select(selectNodeActionError);
  readonly tokens$ = this.store.select(selectJoinTokens);
  readonly tokensLoading$ = this.store.select(selectJoinTokensLoading);
  readonly tokensError$ = this.store.select(selectJoinTokensError);
  readonly creatingToken$ = this.store.select(selectCreatingJoinToken);
  readonly createdToken$ = this.store.select(selectCreatedJoinToken);
  readonly revokingToken$ = this.store.select(selectRevokingJoinToken);
  readonly tokenError$ = this.store.select(selectJoinTokenError);

  /** `silent`: refresh without the loading state. */
  load(silent = false): void {
    this.store.dispatch(loadNodes({ silent }));
  }

  open(name: string, silent = false): void {
    this.store.dispatch(loadNode({ name, silent }));
  }

  act(name: string, action: NodeAction): void {
    this.store.dispatch(nodeAction({ name, action }));
  }

  clearActionError(): void {
    this.store.dispatch(clearNodeActionError());
  }

  loadJoinTokens(): void {
    this.store.dispatch(loadJoinTokens());
  }

  createJoinToken(request: CreateJoinTokenRequest): void {
    this.store.dispatch(createJoinToken({ request }));
  }

  clearCreatedJoinToken(): void {
    this.store.dispatch(clearCreatedJoinToken());
  }

  revokeJoinToken(id: string): void {
    this.store.dispatch(revokeJoinToken({ id }));
  }

  /** The one-line installer's URL for the join command (fleet mode: the cluster's own, `null` while unknown). */
  installScriptUrl(): string | null {
    return this.service.installScriptUrl();
  }
}
