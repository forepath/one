import { createAction, props } from '@ngrx/store';

import type {
  CreateKnowledgeNodeDto,
  CreateKnowledgeRelationDto,
  KnowledgePageActivityDto,
  KnowledgeNodeDto,
  KnowledgeRelationDto,
  KnowledgeRelationSourceType,
  UpdateKnowledgeNodeDto,
} from './knowledge.types';

export const loadKnowledgeTree = createAction('[Knowledge] Load Tree', props<{ clientId: string }>());
export const loadKnowledgeTreeSuccess = createAction(
  '[Knowledge] Load Tree Success',
  props<{ clientId: string; tree: KnowledgeNodeDto[] }>(),
);
export const loadKnowledgeTreeFailure = createAction('[Knowledge] Load Tree Failure', props<{ error: string }>());

export const selectKnowledgeNode = createAction('[Knowledge] Select Node', props<{ nodeId: string | null }>());

export const createKnowledgeNode = createAction('[Knowledge] Create Node', props<{ dto: CreateKnowledgeNodeDto }>());
export const createKnowledgeNodeSuccess = createAction(
  '[Knowledge] Create Node Success',
  props<{ node: KnowledgeNodeDto }>(),
);
export const createKnowledgeNodeFailure = createAction('[Knowledge] Create Node Failure', props<{ error: string }>());

export const updateKnowledgeNode = createAction(
  '[Knowledge] Update Node',
  props<{ id: string; dto: UpdateKnowledgeNodeDto }>(),
);
export const updateKnowledgeNodeSuccess = createAction(
  '[Knowledge] Update Node Success',
  props<{ node: KnowledgeNodeDto }>(),
);
export const updateKnowledgeNodeFailure = createAction('[Knowledge] Update Node Failure', props<{ error: string }>());

export const duplicateKnowledgeNode = createAction('[Knowledge] Duplicate Node', props<{ id: string }>());
export const duplicateKnowledgeNodeSuccess = createAction(
  '[Knowledge] Duplicate Node Success',
  props<{ node: KnowledgeNodeDto }>(),
);
export const duplicateKnowledgeNodeFailure = createAction(
  '[Knowledge] Duplicate Node Failure',
  props<{ error: string }>(),
);

export const deleteKnowledgeNode = createAction(
  '[Knowledge] Delete Node',
  props<{ id: string; releaseExternalSyncMarker?: boolean }>(),
);
export const deleteKnowledgeNodeSuccess = createAction('[Knowledge] Delete Node Success', props<{ id: string }>());
export const deleteKnowledgeNodeFailure = createAction('[Knowledge] Delete Node Failure', props<{ error: string }>());

export const loadKnowledgeRelations = createAction(
  '[Knowledge] Load Relations',
  props<{ clientId: string; sourceType: KnowledgeRelationSourceType; sourceId: string }>(),
);
export const loadKnowledgeRelationsSuccess = createAction(
  '[Knowledge] Load Relations Success',
  props<{ relations: KnowledgeRelationDto[] }>(),
);
export const loadKnowledgeRelationsFailure = createAction(
  '[Knowledge] Load Relations Failure',
  props<{ error: string }>(),
);

export const createKnowledgeRelation = createAction(
  '[Knowledge] Create Relation',
  props<{ dto: CreateKnowledgeRelationDto }>(),
);
export const createKnowledgeRelationSuccess = createAction(
  '[Knowledge] Create Relation Success',
  props<{ relation: KnowledgeRelationDto }>(),
);
export const createKnowledgeRelationFailure = createAction(
  '[Knowledge] Create Relation Failure',
  props<{ error: string }>(),
);

export const deleteKnowledgeRelation = createAction('[Knowledge] Delete Relation', props<{ id: string }>());
export const deleteKnowledgeRelationSuccess = createAction(
  '[Knowledge] Delete Relation Success',
  props<{ id: string }>(),
);
export const deleteKnowledgeRelationFailure = createAction(
  '[Knowledge] Delete Relation Failure',
  props<{ error: string }>(),
);

export const loadKnowledgeActivity = createAction('[Knowledge] Load Activity', props<{ pageId: string }>());
export const loadKnowledgeActivitySuccess = createAction(
  '[Knowledge] Load Activity Success',
  props<{ pageId: string; activity: KnowledgePageActivityDto[] }>(),
);
export const loadKnowledgeActivityFailure = createAction(
  '[Knowledge] Load Activity Failure',
  props<{ error: string }>(),
);
export const prependKnowledgeActivity = createAction(
  '[Knowledge] Prepend Activity',
  props<{ activity: KnowledgePageActivityDto }>(),
);
