import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, forkJoin, map, mergeMap, of, switchMap } from 'rxjs';

import { ContextImportAdminService } from '../../services/context-import-admin.service';

import {
  clearExternalImportMarkers,
  clearExternalImportMarkersFailure,
  clearExternalImportMarkersSuccess,
  createAtlassianConnection,
  createAtlassianConnectionFailure,
  createAtlassianConnectionSuccess,
  createExternalImportConfig,
  createExternalImportConfigFailure,
  createExternalImportConfigSuccess,
  deleteAtlassianConnection,
  deleteAtlassianConnectionFailure,
  deleteAtlassianConnectionSuccess,
  deleteExternalImportConfig,
  deleteExternalImportConfigFailure,
  deleteExternalImportConfigSuccess,
  loadAtlassianContextImportBatch,
  loadAtlassianContextImport,
  loadAtlassianContextImportFailure,
  loadAtlassianContextImportSuccess,
  runExternalImportConfig,
  runExternalImportConfigFailure,
  runExternalImportConfigSuccess,
  testAtlassianConnection,
  testAtlassianConnectionFailure,
  testAtlassianConnectionSuccess,
  updateAtlassianConnection,
  updateAtlassianConnectionFailure,
  updateAtlassianConnectionSuccess,
  updateExternalImportConfig,
  updateExternalImportConfigFailure,
  updateExternalImportConfigSuccess,
} from './context-import.actions';

function normalizeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    return error.error?.message ?? error.message ?? String(error.status);
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
}

const ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE = 10;

export const loadAtlassianContextImport$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(loadAtlassianContextImport),
      switchMap(() =>
        forkJoin({
          configs: svc.listConfigs({
            limit: ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE,
            offset: 0,
          }),
          connections: svc.listConnections({
            limit: ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE,
            offset: 0,
          }),
        }).pipe(
          switchMap(({ configs, connections }) => {
            const nextConnectionOffset =
              connections.length < ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE ? null : ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE;
            const nextConfigOffset =
              configs.length < ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE ? null : ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE;

            if (nextConnectionOffset === null && nextConfigOffset === null) {
              return of(loadAtlassianContextImportSuccess({ connections, configs }));
            }

            return of(
              loadAtlassianContextImportBatch({
                accumulatedConnections: connections,
                accumulatedConfigs: configs,
                nextConnectionOffset,
                nextConfigOffset,
              }),
            );
          }),
          catchError((error) => of(loadAtlassianContextImportFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const loadAtlassianContextImportBatch$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(loadAtlassianContextImportBatch),
      switchMap(({ accumulatedConnections, accumulatedConfigs, nextConnectionOffset, nextConfigOffset }) => {
        const requests: {
          connections?: ReturnType<ContextImportAdminService['listConnections']>;
          configs?: ReturnType<ContextImportAdminService['listConfigs']>;
        } = {};

        if (nextConnectionOffset != null) {
          requests.connections = svc.listConnections({
            limit: ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE,
            offset: nextConnectionOffset,
          });
        }

        if (nextConfigOffset != null) {
          requests.configs = svc.listConfigs({
            limit: ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE,
            offset: nextConfigOffset,
          });
        }

        return forkJoin(requests).pipe(
          switchMap((pages) => {
            let accConn = [...accumulatedConnections];
            let accCfg = [...accumulatedConfigs];
            let nextCO = nextConnectionOffset;
            let nextFO = nextConfigOffset;

            if (pages.connections) {
              const page = pages.connections;

              accConn = [...accConn, ...page];
              nextCO =
                page.length < ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE
                  ? null
                  : nextConnectionOffset! + ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE;
            }

            if (pages.configs) {
              const page = pages.configs;

              accCfg = [...accCfg, ...page];
              nextFO =
                page.length < ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE
                  ? null
                  : nextConfigOffset! + ATLASSIAN_CONTEXT_IMPORT_BATCH_SIZE;
            }

            if (nextCO === null && nextFO === null) {
              return of(loadAtlassianContextImportSuccess({ connections: accConn, configs: accCfg }));
            }

            return of(
              loadAtlassianContextImportBatch({
                accumulatedConnections: accConn,
                accumulatedConfigs: accCfg,
                nextConnectionOffset: nextCO,
                nextConfigOffset: nextFO,
              }),
            );
          }),
          catchError((error) => of(loadAtlassianContextImportFailure({ error: normalizeError(error) }))),
        );
      }),
    );
  },
  { functional: true },
);

export const createAtlassianConnection$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(createAtlassianConnection),
      switchMap(({ dto }) =>
        svc.createConnection(dto).pipe(
          map((connection) => createAtlassianConnectionSuccess({ connection })),
          catchError((error) => of(createAtlassianConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateAtlassianConnection$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(updateAtlassianConnection),
      switchMap(({ id, dto }) =>
        svc.updateConnection(id, dto).pipe(
          map((connection) => updateAtlassianConnectionSuccess({ connection })),
          catchError((error) => of(updateAtlassianConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteAtlassianConnection$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(deleteAtlassianConnection),
      switchMap(({ id }) =>
        svc.deleteConnection(id).pipe(
          map(() => deleteAtlassianConnectionSuccess({ id })),
          catchError((error) => of(deleteAtlassianConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const testAtlassianConnection$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(testAtlassianConnection),
      switchMap(({ id }) =>
        svc.testConnection(id).pipe(
          map((result) => testAtlassianConnectionSuccess({ connectionId: id, result })),
          catchError((error) => of(testAtlassianConnectionFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const createExternalImportConfig$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(createExternalImportConfig),
      switchMap(({ dto }) =>
        svc.createConfig(dto).pipe(
          map((config) => createExternalImportConfigSuccess({ config })),
          catchError((error) => of(createExternalImportConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const updateExternalImportConfig$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(updateExternalImportConfig),
      switchMap(({ id, dto }) =>
        svc.updateConfig(id, dto).pipe(
          map((config) => updateExternalImportConfigSuccess({ config })),
          catchError((error) => of(updateExternalImportConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const deleteExternalImportConfig$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(deleteExternalImportConfig),
      switchMap(({ id }) =>
        svc.deleteConfig(id).pipe(
          map(() => deleteExternalImportConfigSuccess({ id })),
          catchError((error) => of(deleteExternalImportConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const runExternalImportConfig$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(runExternalImportConfig),
      switchMap(({ id }) =>
        svc.runConfig(id).pipe(
          mergeMap(() => [runExternalImportConfigSuccess({ id }), loadAtlassianContextImport()]),
          catchError((error) => of(runExternalImportConfigFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);

export const clearExternalImportMarkers$ = createEffect(
  (actions$ = inject(Actions), svc = inject(ContextImportAdminService)) => {
    return actions$.pipe(
      ofType(clearExternalImportMarkers),
      switchMap(({ id }) =>
        svc.clearMarkers(id).pipe(
          switchMap(() => of(clearExternalImportMarkersSuccess({ id }))),
          catchError((error) => of(clearExternalImportMarkersFailure({ error: normalizeError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
