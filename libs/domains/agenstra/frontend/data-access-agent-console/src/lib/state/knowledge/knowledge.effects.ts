import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, map, of, switchMap, withLatestFrom } from 'rxjs';

import { KnowledgeService } from '../../services/knowledge.service';
import { selectActiveClientId } from '../clients/clients.selectors';

import {
  createKnowledgeRelation,
  createKnowledgeRelationFailure,
  createKnowledgeRelationSuccess,
  createKnowledgeNode,
  createKnowledgeNodeFailure,
  createKnowledgeNodeSuccess,
  deleteKnowledgeRelation,
  deleteKnowledgeRelationFailure,
  deleteKnowledgeRelationSuccess,
  deleteKnowledgeNode,
  deleteKnowledgeNodeFailure,
  deleteKnowledgeNodeSuccess,
  duplicateKnowledgeNode,
  duplicateKnowledgeNodeFailure,
  duplicateKnowledgeNodeSuccess,
  loadKnowledgeRelations,
  loadKnowledgeRelationsFailure,
  loadKnowledgeRelationsSuccess,
  loadKnowledgeActivity,
  loadKnowledgeActivityFailure,
  loadKnowledgeActivitySuccess,
  loadKnowledgeTree,
  loadKnowledgeTreeFailure,
  loadKnowledgeTreeSuccess,
  updateKnowledgeNode,
  updateKnowledgeNodeFailure,
  updateKnowledgeNodeSuccess,
  uploadKnowledgeTextFiles,
  uploadKnowledgeTextFilesFailure,
  uploadKnowledgeTextFilesSuccess,
} from './knowledge.actions';
import { selectKnowledgeSelectedNodeId } from './knowledge.selectors';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: unknown } | string | null | undefined;

    if (typeof body === 'string' && body.trim().length > 0) {
      return body;
    }

    if (body && typeof body === 'object' && typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message;
    }

    return error.message || String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

export const loadKnowledgeTree$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(loadKnowledgeTree),
      switchMap(({ clientId, search }) =>
        knowledgeService.getTree(clientId, search?.trim() || undefined).pipe(
          map((tree) => loadKnowledgeTreeSuccess({ clientId, tree })),
          catchError((error) => of(loadKnowledgeTreeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createKnowledgeNode$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(createKnowledgeNode),
      concatMap(({ dto }) =>
        knowledgeService.create(dto).pipe(
          map((node) => createKnowledgeNodeSuccess({ node })),
          catchError((error) => of(createKnowledgeNodeFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const uploadKnowledgeTextFiles$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(uploadKnowledgeTextFiles),
      concatMap(({ dto }) =>
        knowledgeService.uploadTextFiles(dto).pipe(
          map((result) => uploadKnowledgeTextFilesSuccess({ result, dto })),
          catchError((error) => of(uploadKnowledgeTextFilesFailure({ error: normalizeError(error), dto }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateKnowledgeNode$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(updateKnowledgeNode),
      concatMap(({ id, dto }) =>
        knowledgeService.update(id, dto).pipe(
          map((node) => updateKnowledgeNodeSuccess({ node })),
          catchError((error) => of(updateKnowledgeNodeFailure({ id, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const duplicateKnowledgeNode$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(duplicateKnowledgeNode),
      concatMap(({ id }) =>
        knowledgeService.duplicate(id).pipe(
          map((node) => duplicateKnowledgeNodeSuccess({ sourceId: id, node })),
          catchError((error) => of(duplicateKnowledgeNodeFailure({ sourceId: id, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteKnowledgeNode$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(deleteKnowledgeNode),
      concatMap(({ id, releaseExternalSyncMarker }) =>
        knowledgeService.delete(id, releaseExternalSyncMarker).pipe(
          map(() => deleteKnowledgeNodeSuccess({ id })),
          catchError((error) => of(deleteKnowledgeNodeFailure({ id, error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadKnowledgeRelations$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(loadKnowledgeRelations),
      switchMap(({ clientId, sourceType, sourceId }) =>
        knowledgeService.listRelations(clientId, sourceType, sourceId).pipe(
          map((relations) => loadKnowledgeRelationsSuccess({ relations })),
          catchError((error) => of(loadKnowledgeRelationsFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createKnowledgeRelation$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(createKnowledgeRelation),
      switchMap(({ dto }) =>
        knowledgeService.createRelation(dto).pipe(
          map((relation) => createKnowledgeRelationSuccess({ relation })),
          catchError((error) => of(createKnowledgeRelationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadKnowledgeActivity$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(loadKnowledgeActivity),
      switchMap(({ pageId }) =>
        knowledgeService.listActivity(pageId, 100, 0).pipe(
          map((activity) => loadKnowledgeActivitySuccess({ pageId, activity })),
          catchError((error) => of(loadKnowledgeActivityFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteKnowledgeRelation$ = createEffect(
  (actions$ = inject(Actions), knowledgeService = inject(KnowledgeService)) => {
    return actions$.pipe(
      ofType(deleteKnowledgeRelation),
      switchMap(({ id }) =>
        knowledgeService.deleteRelation(id).pipe(
          map(() => deleteKnowledgeRelationSuccess({ id })),
          catchError((error) => of(deleteKnowledgeRelationFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const reloadRelationsAfterWrite$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(createKnowledgeRelationSuccess, deleteKnowledgeRelationSuccess),
      withLatestFrom(store.select(selectActiveClientId), store.select(selectKnowledgeSelectedNodeId)),
      switchMap(([, clientId, sourceId]) =>
        clientId && sourceId
          ? of(loadKnowledgeRelations({ clientId, sourceType: 'page', sourceId }))
          : of(loadKnowledgeRelationsFailure({ error: 'No active page selected' })),
      ),
    );
  },
  { functional: true },
);

export const reloadActivityAfterWrite$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(
        createKnowledgeRelationSuccess,
        deleteKnowledgeRelationSuccess,
        updateKnowledgeNodeSuccess,
        duplicateKnowledgeNodeSuccess,
      ),
      withLatestFrom(store.select(selectKnowledgeSelectedNodeId)),
      switchMap(([, pageId]) =>
        pageId
          ? of(loadKnowledgeActivity({ pageId }))
          : of(loadKnowledgeActivityFailure({ error: 'No active page selected' })),
      ),
    );
  },
  { functional: true },
);

export const reloadTreeAfterWrite$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) => {
    return actions$.pipe(
      ofType(
        createKnowledgeNodeSuccess,
        updateKnowledgeNodeSuccess,
        duplicateKnowledgeNodeSuccess,
        deleteKnowledgeNodeSuccess,
        uploadKnowledgeTextFilesSuccess,
      ),
      withLatestFrom(store.select(selectActiveClientId)),
      map(([, clientId]) => clientId),
      switchMap((clientId) =>
        clientId
          ? of(loadKnowledgeTree({ clientId }))
          : of(loadKnowledgeTreeFailure({ error: 'No active workspace selected' })),
      ),
    );
  },
  { functional: true },
);
