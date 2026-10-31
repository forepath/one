import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { HealthEntity, HealthTreeNode } from '../../types/health.types';
import type { ConsoleHealthState } from './health.reducer';

/** Entities into trees by `parent`; entities whose parent isn't visible become roots. Children sorted by key. */
export function buildHealthTree(entities: readonly HealthEntity[]): HealthTreeNode[] {
  const nodes = new Map(entities.map((entity) => [entity.key, { entity, children: [] as HealthTreeNode[] }]));
  const roots: HealthTreeNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.entity.parent ? nodes.get(node.entity.parent) : undefined;

    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: HealthTreeNode[]): HealthTreeNode[] => {
    list.sort((a, b) => a.entity.key.localeCompare(b.entity.key));
    list.forEach((n) => sort(n.children));

    return list;
  };

  // Infrastructure (cluster) before projects.
  return sort(roots).sort((a, b) => Number(a.entity.kind !== 'cluster') - Number(b.entity.kind !== 'cluster'));
}

export const selectConsoleHealthState = createFeatureSelector<ConsoleHealthState>('consoleHealth');

export const selectHealthEntities = createSelector(selectConsoleHealthState, (state) => state.entities);
export const selectHealthTree = createSelector(selectHealthEntities, buildHealthTree);
export const selectHealthLoading = createSelector(selectConsoleHealthState, (state) => state.loading);
export const selectHealthError = createSelector(selectConsoleHealthState, (state) => state.error);
export const selectHealthProject = createSelector(selectConsoleHealthState, (state) => state.project);
export const selectHealthDetailKey = createSelector(selectConsoleHealthState, (state) => state.detailKey);
export const selectHealthDetailEntity = createSelector(
  selectConsoleHealthState,
  (state) => state.detail.find((e) => e.key === state.detailKey) ?? null,
);
/** The detail entity's descendants as trees (its direct children are the roots). */
export const selectHealthDetailChildren = createSelector(selectConsoleHealthState, (state) =>
  buildHealthTree(state.detail.filter((e) => e.key !== state.detailKey)),
);
export const selectHealthDetailLoading = createSelector(selectConsoleHealthState, (state) => state.detailLoading);
export const selectHealthDetailError = createSelector(selectConsoleHealthState, (state) => state.detailError);
export const selectHealthHistory = createSelector(selectConsoleHealthState, (state) => state.history);
export const selectHealthHistoryLoading = createSelector(selectConsoleHealthState, (state) => state.historyLoading);
export const selectHealthHistoryError = createSelector(selectConsoleHealthState, (state) => state.historyError);
