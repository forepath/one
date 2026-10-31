import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleNode } from '../../types/nodes.types';
import type { ConsoleNodesState } from './nodes.reducer';

export const selectConsoleNodesState = createFeatureSelector<ConsoleNodesState>('consoleNodes');

export const selectNodes = createSelector(selectConsoleNodesState, (state) => state.nodes);
export const selectClusterSummary = createSelector(selectConsoleNodesState, (state) => state.cluster);
export const selectNodesLoading = createSelector(selectConsoleNodesState, (state) => state.loading);
export const selectNodesError = createSelector(selectConsoleNodesState, (state) => state.error);
export const selectSelectedNode = createSelector(selectConsoleNodesState, (state) => state.selected);
export const selectSelectedNodeLoading = createSelector(selectConsoleNodesState, (state) => state.selectedLoading);
export const selectSelectedNodeError = createSelector(selectConsoleNodesState, (state) => state.selectedError);
export const selectNodeActing = createSelector(selectConsoleNodesState, (state) => state.acting);
export const selectNodeActionError = createSelector(selectConsoleNodesState, (state) => state.actionError);
export const selectJoinTokens = createSelector(selectConsoleNodesState, (state) => state.tokens);
export const selectJoinTokensLoading = createSelector(selectConsoleNodesState, (state) => state.tokensLoading);
export const selectJoinTokensError = createSelector(selectConsoleNodesState, (state) => state.tokensError);
export const selectCreatingJoinToken = createSelector(selectConsoleNodesState, (state) => state.creatingToken);
export const selectCreatedJoinToken = createSelector(selectConsoleNodesState, (state) => state.createdToken);
export const selectRevokingJoinToken = createSelector(selectConsoleNodesState, (state) => state.revokingToken);
export const selectJoinTokenError = createSelector(selectConsoleNodesState, (state) => state.tokenError);

export interface NodeSite {
  site: string;
  nodes: ConsoleNode[];
}

/** Nodes per site (sites by name, nodes by name); nodes that left are listed last within their site. */
export const selectNodesBySite = createSelector(selectNodes, (nodes): NodeSite[] => {
  const sites = new Map<string, ConsoleNode[]>();

  for (const node of nodes) sites.set(node.site, [...(sites.get(node.site) ?? []), node]);

  return [...sites.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([site, list]) => ({
      site,
      nodes: [...list].sort(
        (a, b) => Number(a.lifecycle === 'left') - Number(b.lifecycle === 'left') || a.name.localeCompare(b.name),
      ),
    }));
});
