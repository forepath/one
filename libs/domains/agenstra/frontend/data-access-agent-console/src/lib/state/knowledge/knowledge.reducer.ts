import { createReducer, on } from '@ngrx/store';

import * as KnowledgeActions from './knowledge.actions';
import type { KnowledgeNodeDto, KnowledgePageActivityDto, KnowledgeRelationDto } from './knowledge.types';

export interface KnowledgeState {
  activeClientId: string | null;
  selectedNodeId: string | null;
  tree: KnowledgeNodeDto[];
  relations: KnowledgeRelationDto[];
  activity: KnowledgePageActivityDto[];
  relationsLoading: boolean;
  activityLoading: boolean;
  loading: boolean;
  /** Node ids currently being created/updated/duplicated/deleted (row busy UI). */
  mutatingIds: ReadonlySet<string>;
  error: string | null;
}

export const initialKnowledgeState: KnowledgeState = {
  activeClientId: null,
  selectedNodeId: null,
  tree: [],
  relations: [],
  activity: [],
  relationsLoading: false,
  activityLoading: false,
  loading: false,
  mutatingIds: new Set(),
  error: null,
};

function withMutatingId(state: KnowledgeState, id: string): ReadonlySet<string> {
  const next = new Set(state.mutatingIds);

  next.add(id);

  return next;
}

function withoutMutatingId(state: KnowledgeState, id: string): ReadonlySet<string> {
  if (!state.mutatingIds.has(id)) {
    return state.mutatingIds;
  }

  const next = new Set(state.mutatingIds);

  next.delete(id);

  return next;
}

export const knowledgeReducer = createReducer(
  initialKnowledgeState,
  on(KnowledgeActions.loadKnowledgeTree, (state, { clientId }) => ({
    ...state,
    activeClientId: clientId,
    loading: true,
    error: null,
  })),
  on(KnowledgeActions.loadKnowledgeTreeSuccess, (state, { clientId, tree }) => ({
    ...state,
    activeClientId: clientId,
    tree,
    loading: false,
    error: null,
  })),
  on(KnowledgeActions.loadKnowledgeRelations, (state) => ({
    ...state,
    relationsLoading: true,
    error: null,
  })),
  on(KnowledgeActions.loadKnowledgeRelationsSuccess, (state, { relations }) => ({
    ...state,
    relations,
    relationsLoading: false,
    error: null,
  })),
  on(KnowledgeActions.loadKnowledgeRelationsFailure, (state, { error }) => ({
    ...state,
    relationsLoading: false,
    error,
  })),
  on(KnowledgeActions.loadKnowledgeActivity, (state) => ({
    ...state,
    activityLoading: true,
    error: null,
  })),
  on(KnowledgeActions.loadKnowledgeActivitySuccess, (state, { pageId, activity }) => ({
    ...state,
    activity: state.selectedNodeId === pageId ? activity : state.activity,
    activityLoading: false,
    error: null,
  })),
  on(KnowledgeActions.loadKnowledgeActivityFailure, (state, { error }) => ({
    ...state,
    activityLoading: false,
    error,
  })),
  on(KnowledgeActions.loadKnowledgeTreeFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(KnowledgeActions.selectKnowledgeNode, (state, { nodeId }) => ({
    ...state,
    selectedNodeId: nodeId,
    ...(nodeId ? {} : { activity: [] }),
  })),
  on(KnowledgeActions.createKnowledgeNode, (state) => ({ ...state, loading: true, error: null })),
  on(KnowledgeActions.uploadKnowledgeTextFiles, (state) => ({ ...state, loading: true, error: null })),
  on(KnowledgeActions.updateKnowledgeNode, (state, { id }) => ({
    ...state,
    loading: true,
    error: null,
    mutatingIds: withMutatingId(state, id),
  })),
  on(KnowledgeActions.duplicateKnowledgeNode, (state, { id }) => ({
    ...state,
    loading: true,
    error: null,
    mutatingIds: withMutatingId(state, id),
  })),
  on(KnowledgeActions.deleteKnowledgeNode, (state, { id }) => ({
    ...state,
    loading: true,
    error: null,
    mutatingIds: withMutatingId(state, id),
  })),
  on(KnowledgeActions.createKnowledgeNodeSuccess, (state) => ({ ...state, loading: false, error: null })),
  on(KnowledgeActions.uploadKnowledgeTextFilesSuccess, (state) => ({ ...state, loading: false, error: null })),
  on(KnowledgeActions.updateKnowledgeNodeSuccess, (state, { node }) => ({
    ...state,
    loading: false,
    error: null,
    mutatingIds: withoutMutatingId(state, node.id),
  })),
  on(KnowledgeActions.duplicateKnowledgeNodeSuccess, (state, { sourceId }) => ({
    ...state,
    loading: false,
    error: null,
    mutatingIds: withoutMutatingId(state, sourceId),
  })),
  on(KnowledgeActions.deleteKnowledgeNodeSuccess, (state, { id }) => ({
    ...state,
    selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    activity: state.selectedNodeId === id ? [] : state.activity,
    loading: false,
    error: null,
    mutatingIds: withoutMutatingId(state, id),
  })),
  on(KnowledgeActions.createKnowledgeNodeFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(KnowledgeActions.uploadKnowledgeTextFilesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(KnowledgeActions.updateKnowledgeNodeFailure, (state, { id, error }) => ({
    ...state,
    loading: false,
    error,
    mutatingIds: withoutMutatingId(state, id),
  })),
  on(KnowledgeActions.duplicateKnowledgeNodeFailure, (state, { sourceId, error }) => ({
    ...state,
    loading: false,
    error,
    mutatingIds: withoutMutatingId(state, sourceId),
  })),
  on(KnowledgeActions.deleteKnowledgeNodeFailure, (state, { id, error }) => ({
    ...state,
    loading: false,
    error,
    mutatingIds: withoutMutatingId(state, id),
  })),
  on(
    KnowledgeActions.createKnowledgeRelationFailure,
    KnowledgeActions.deleteKnowledgeRelationFailure,
    (state, { error }) => ({
      ...state,
      relationsLoading: false,
      error,
    }),
  ),
  on(KnowledgeActions.createKnowledgeRelationSuccess, (state, { relation }) => ({
    ...state,
    relations: state.relations.some((r) => r.id === relation.id) ? state.relations : [...state.relations, relation],
    error: null,
  })),
  on(KnowledgeActions.deleteKnowledgeRelationSuccess, (state, { id }) => ({
    ...state,
    relations: state.relations.filter((r) => r.id !== id),
    error: null,
  })),
  on(KnowledgeActions.prependKnowledgeActivity, (state, { activity }) => {
    if (state.selectedNodeId !== activity.pageId) {
      return state;
    }

    if (state.activity.some((row) => row.id === activity.id)) {
      return state;
    }

    return { ...state, activity: [activity, ...state.activity] };
  }),
);
