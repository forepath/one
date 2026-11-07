import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { EMPTY, catchError, debounceTime, filter, forkJoin, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs';

import { InitiativesService } from '../../services/initiatives.service';
import { initiativesBoardSocketReconnected } from '../initiatives-board-socket/initiatives-board-socket.actions';

import {
  initiativeArtifactLiveUpsert,
  initiativeDecisionLiveUpsert,
  initiativeFindingLiveUpsert,
  initiativeLiveUpsert,
  initiativeProposalLiveUpsert,
  initiativeRunLiveUpsert,
  initiativeWorkItemsLiveChanged,
  loadInitiativeArtifactVersion,
  loadInitiativeArtifactVersionSuccess,
  loadInitiativeDetailFailure,
  loadInitiativeDetailSuccess,
  loadInitiatives,
  loadInitiativesFailure,
  loadInitiativesSuccess,
  openInitiativeArtifact,
  openInitiativeArtifactSuccess,
  openInitiativeRun,
  openInitiativeRunSuccess,
  reloadInitiativeOverview,
  reloadInitiativeOverviewSuccess,
  runInitiativeCommand,
  runInitiativeCommandFailure,
  runInitiativeCommandSuccess,
  reloadInitiative,
  selectInitiative,
} from './initiatives.actions';
import { selectInitiativesState } from './initiatives.selectors';

/** The overview (next actions, counts) is reloaded at most this often while live updates arrive. */
export const INITIATIVE_OVERVIEW_RELOAD_DEBOUNCE_MS = 600;

export function normalizeInitiativeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;

    if (Array.isArray(message)) {
      return message.join('; ');
    }

    return message ?? error.message ?? String(error.status);
  }

  return error instanceof Error ? error.message : String(error);
}

export const loadInitiatives$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(loadInitiatives),
      switchMap(({ clientId, search, state }) =>
        service.list(clientId, { search, state: state ?? undefined, limit: 200 }).pipe(
          map(({ items, total }) => loadInitiativesSuccess({ clientId, items, total })),
          catchError((error) => of(loadInitiativesFailure({ error: normalizeInitiativeError(error) }))),
        ),
      ),
    ),
  { functional: true },
);

function loadDetail(service: InitiativesService, id: string) {
  return forkJoin({
    overview: service.overview(id),
    artifacts: service.artifacts(id),
    workItems: service.workItems(id),
    runs: service.runs(id),
    proposals: service.proposals(id),
    findings: service.findings(id),
    decisions: service.decisions(id),
    activity: service.activity(id),
  }).pipe(map((detail) => loadInitiativeDetailSuccess({ id, ...detail })));
}

export const loadInitiativeDetail$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(selectInitiative),
      switchMap(({ id }) =>
        !id
          ? EMPTY
          : loadDetail(service, id).pipe(
              catchError((error) => of(loadInitiativeDetailFailure({ error: normalizeInitiativeError(error) }))),
            ),
      ),
    ),
  { functional: true },
);

export const reloadInitiative$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(reloadInitiative),
      withLatestFrom(store.select(selectInitiativesState)),
      switchMap(([{ id }, state]) =>
        id !== state.selectedId
          ? EMPTY
          : loadDetail(service, id).pipe(
              switchMap((loaded) =>
                of(
                  loaded,
                  ...(state.openArtifactId ? [openInitiativeArtifact({ artifactId: state.openArtifactId })] : []),
                  ...(state.openRunId ? [openInitiativeRun({ runId: state.openRunId })] : []),
                ),
              ),
              catchError((error) => of(loadInitiativeDetailFailure({ error: normalizeInitiativeError(error) }))),
            ),
      ),
    ),
  { functional: true },
);

/** Events sent while the socket was down are lost: refetch the open initiative after a reconnect. */
export const reloadInitiativeAfterReconnect$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(initiativesBoardSocketReconnected),
      withLatestFrom(store.select(selectInitiativesState)),
      switchMap(([, state]) => (state.selectedId ? of(reloadInitiative({ id: state.selectedId })) : EMPTY)),
    ),
  { functional: true },
);

export const reloadInitiativeOverview$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(reloadInitiativeOverview),
      switchMap(({ id }) =>
        service.overview(id).pipe(
          map((overview) => reloadInitiativeOverviewSuccess({ overview })),
          catchError(() => EMPTY),
        ),
      ),
    ),
  { functional: true },
);

/** Live changes of the selected initiative refresh its overview (next actions, counts), debounced. */
export const reloadOverviewOnLiveChanges$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(
        initiativeLiveUpsert,
        initiativeArtifactLiveUpsert,
        initiativeWorkItemsLiveChanged,
        initiativeRunLiveUpsert,
        initiativeProposalLiveUpsert,
        initiativeFindingLiveUpsert,
        initiativeDecisionLiveUpsert,
        runInitiativeCommandSuccess,
      ),
      debounceTime(INITIATIVE_OVERVIEW_RELOAD_DEBOUNCE_MS),
      withLatestFrom(store.select(selectInitiativesState)),
      filter(([, state]) => !!state.selectedId),
      map(([, state]) => reloadInitiativeOverview({ id: state.selectedId as string })),
    ),
  { functional: true },
);

export const openInitiativeArtifact$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(openInitiativeArtifact),
      switchMap(({ artifactId }) =>
        !artifactId
          ? EMPTY
          : forkJoin({ artifact: service.artifact(artifactId), versions: service.artifactVersions(artifactId) }).pipe(
              map(({ artifact, versions }) => openInitiativeArtifactSuccess({ artifact, versions })),
              catchError((error) => of(loadInitiativeDetailFailure({ error: normalizeInitiativeError(error) }))),
            ),
      ),
    ),
  { functional: true },
);

/** Another user saved a new version of the open document: fetch it (the editor keeps unsaved edits). */
export const refreshOpenArtifact$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store)) =>
    actions$.pipe(
      ofType(initiativeArtifactLiveUpsert),
      withLatestFrom(store.select(selectInitiativesState)),
      filter(
        ([{ artifact }, state]) =>
          state.openArtifactId === artifact.id &&
          (!state.openArtifact || state.openArtifact.version < artifact.version),
      ),
      map(([{ artifact }]) => openInitiativeArtifact({ artifactId: artifact.id })),
    ),
  { functional: true },
);

export const loadInitiativeArtifactVersion$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(loadInitiativeArtifactVersion),
      switchMap(({ artifactId, version }) =>
        version === null
          ? of(loadInitiativeArtifactVersionSuccess({ version: null }))
          : service.artifactVersion(artifactId, version).pipe(
              map((row) => loadInitiativeArtifactVersionSuccess({ version: row })),
              catchError(() => of(loadInitiativeArtifactVersionSuccess({ version: null }))),
            ),
      ),
    ),
  { functional: true },
);

export const openInitiativeRun$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(openInitiativeRun),
      switchMap(({ runId }) =>
        !runId
          ? EMPTY
          : service.run(runId).pipe(
              map((run) => openInitiativeRunSuccess({ run })),
              catchError((error) => of(loadInitiativeDetailFailure({ error: normalizeInitiativeError(error) }))),
            ),
      ),
    ),
  { functional: true },
);

/** Every command is one REST call (parallel commands stay independent). 409 marks the result as a conflict. */
export const runInitiativeCommand$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(runInitiativeCommand),
      mergeMap(({ command }) =>
        service.execute(command).pipe(
          map((result) => runInitiativeCommandSuccess({ command, result })),
          catchError((error) =>
            of(
              runInitiativeCommandFailure({
                command,
                error: normalizeInitiativeError(error),
                conflict: error instanceof HttpErrorResponse && error.status === 409,
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Work items of a deleted unknown / new unknown: reload the tree (unknowns live in it). */
export const reloadWorkItemsAfterUnknownChange$ = createEffect(
  (actions$ = inject(Actions), service = inject(InitiativesService)) =>
    actions$.pipe(
      ofType(runInitiativeCommandSuccess),
      filter(({ result }) => result.kind === 'unknown'),
      mergeMap(({ result }) => {
        const initiativeId = (result as { initiativeId: string }).initiativeId;

        return service.workItems(initiativeId).pipe(
          map((workItems) => initiativeWorkItemsLiveChanged({ initiativeId, workItems })),
          catchError(() => EMPTY),
        );
      }),
    ),
  { functional: true },
);
