import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import * as KnowledgeActions from './knowledge.actions';
import {
  selectKnowledgeActivity,
  selectKnowledgeActivityLoading,
  selectKnowledgeError,
  selectKnowledgeLoading,
  selectKnowledgeRelations,
  selectKnowledgeRelationsLoading,
  selectKnowledgeSelectedNode,
  selectKnowledgeSelectedNodeId,
  selectKnowledgeTree,
} from './knowledge.selectors';
import type {
  CreateKnowledgeNodeDto,
  CreateKnowledgeRelationDto,
  KnowledgeRelationSourceType,
  UpdateKnowledgeNodeDto,
} from './knowledge.types';

@Injectable()
export class KnowledgeFacade {
  private readonly store = inject(Store);

  readonly tree$ = this.store.select(selectKnowledgeTree);
  readonly loading$ = this.store.select(selectKnowledgeLoading);
  readonly error$ = this.store.select(selectKnowledgeError);
  readonly relations$ = this.store.select(selectKnowledgeRelations);
  readonly relationsLoading$ = this.store.select(selectKnowledgeRelationsLoading);
  readonly activity$ = this.store.select(selectKnowledgeActivity);
  readonly activityLoading$ = this.store.select(selectKnowledgeActivityLoading);
  readonly selectedNodeId$ = this.store.select(selectKnowledgeSelectedNodeId);
  readonly selectedNode$ = this.store.select(selectKnowledgeSelectedNode);

  loadTree(clientId: string): void {
    this.store.dispatch(KnowledgeActions.loadKnowledgeTree({ clientId }));
  }

  selectNode(nodeId: string | null): void {
    this.store.dispatch(KnowledgeActions.selectKnowledgeNode({ nodeId }));
  }

  createNode(dto: CreateKnowledgeNodeDto): void {
    this.store.dispatch(KnowledgeActions.createKnowledgeNode({ dto }));
  }

  updateNode(id: string, dto: UpdateKnowledgeNodeDto): void {
    this.store.dispatch(KnowledgeActions.updateKnowledgeNode({ id, dto }));
  }

  duplicateNode(id: string): void {
    this.store.dispatch(KnowledgeActions.duplicateKnowledgeNode({ id }));
  }

  deleteNode(id: string, releaseExternalSyncMarker?: boolean): void {
    this.store.dispatch(KnowledgeActions.deleteKnowledgeNode({ id, releaseExternalSyncMarker }));
  }

  loadRelations(clientId: string, sourceType: KnowledgeRelationSourceType, sourceId: string): void {
    this.store.dispatch(KnowledgeActions.loadKnowledgeRelations({ clientId, sourceType, sourceId }));
  }

  createRelation(dto: CreateKnowledgeRelationDto): void {
    this.store.dispatch(KnowledgeActions.createKnowledgeRelation({ dto }));
  }

  deleteRelation(id: string): void {
    this.store.dispatch(KnowledgeActions.deleteKnowledgeRelation({ id }));
  }

  loadActivity(pageId: string): void {
    this.store.dispatch(KnowledgeActions.loadKnowledgeActivity({ pageId }));
  }
}
