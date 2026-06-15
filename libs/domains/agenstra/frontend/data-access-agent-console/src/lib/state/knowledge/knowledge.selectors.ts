import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { KnowledgeState } from './knowledge.reducer';
import type { KnowledgeNodeDto } from './knowledge.types';

export const selectKnowledgeState = createFeatureSelector<KnowledgeState>('knowledge');

export const selectKnowledgeTree = createSelector(selectKnowledgeState, (state) => state.tree);
export const selectKnowledgeLoading = createSelector(selectKnowledgeState, (state) => state.loading);
export const selectKnowledgeRelationsLoading = createSelector(selectKnowledgeState, (state) => state.relationsLoading);
export const selectKnowledgeActivityLoading = createSelector(selectKnowledgeState, (state) => state.activityLoading);
export const selectKnowledgeError = createSelector(selectKnowledgeState, (state) => state.error);
export const selectKnowledgeSelectedNodeId = createSelector(selectKnowledgeState, (state) => state.selectedNodeId);
export const selectKnowledgeRelations = createSelector(selectKnowledgeState, (state) => state.relations);
export const selectKnowledgeActivity = createSelector(selectKnowledgeState, (state) => state.activity);

const flattenTree = (nodes: KnowledgeNodeDto[]): KnowledgeNodeDto[] => {
  const out: KnowledgeNodeDto[] = [];
  const walk = (list: KnowledgeNodeDto[]) => {
    for (const node of list) {
      out.push(node);

      if (node.children?.length) {
        walk(node.children);
      }
    }
  };

  walk(nodes);

  return out;
};

export const selectKnowledgeSelectedNode = createSelector(
  selectKnowledgeTree,
  selectKnowledgeSelectedNodeId,
  (tree, selectedNodeId) => flattenTree(tree).find((node) => node.id === selectedNodeId) ?? null,
);
