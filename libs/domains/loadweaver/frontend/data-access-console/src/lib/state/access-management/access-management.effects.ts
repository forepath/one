import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, concatMap, exhaustMap, forkJoin, map, mergeMap, of, switchMap, take } from 'rxjs';

import { AccessManagementService } from '../../services/access-management.service';
import { ResourcesService } from '../../services/resources.service';
import { apiErrorMessage } from '../../utils/api-error';
import { selectAccessMe } from '../access/access.selectors';
import {
  acceptCrossProjectRequest,
  accessChangeFailure,
  accessChangeSuccess,
  exportAccess,
  exportAccessFailure,
  exportAccessSuccess,
  importAccess,
  importAccessFailure,
  importAccessSuccess,
  loadAccessProjects,
  loadAccessProjectsSuccess,
  loadClusterMembers,
  loadClusterMembersFailure,
  loadClusterMembersSuccess,
  loadProjectAccess,
  loadProjectAccessFailure,
  loadProjectAccessSuccess,
  removeClusterMember,
  removeProjectMember,
  setClusterMember,
  setProjectMember,
  updateProjectSettings,
  updateProjectSettingsSuccess,
} from './access-management.actions';
import { selectAccessProject } from './access-management.selectors';

/** The caller's projects plus, for cluster roles, every `Project` resource (which may fail on its own). */
export const loadAccessProjects$ = createEffect(
  (actions$ = inject(Actions), store = inject(Store), resources = inject(ResourcesService)) =>
    actions$.pipe(
      ofType(loadAccessProjects),
      switchMap(() =>
        store.select(selectAccessMe).pipe(
          take(1),
          switchMap((me) => {
            const own = Object.keys(me?.projects ?? {});

            if (!me?.clusterRole) return of(own);

            return resources.list('Project').pipe(
              map((list) => [...own, ...list.map((r) => r.metadata.name)]),
              catchError(() => of(own)),
            );
          }),
          map((names) => loadAccessProjectsSuccess({ projects: [...new Set(names)].sort() })),
        ),
      ),
    ),
  { functional: true },
);

export const loadClusterMembers$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(loadClusterMembers),
      switchMap(() =>
        service.clusterMembers().pipe(
          map((members) => loadClusterMembersSuccess({ members })),
          catchError((error: unknown) =>
            of(loadClusterMembersFailure({ error: apiErrorMessage(error, 'Failed to load cluster members') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadProjectAccess$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(loadProjectAccess),
      switchMap(({ project }) =>
        forkJoin({
          members: service.members(project),
          settings: service.settings(project),
          requests: service.requests(project),
        }).pipe(
          map(({ members, settings, requests }) =>
            loadProjectAccessSuccess({ access: { project, members, settings, requests } }),
          ),
          catchError((error: unknown) =>
            of(loadProjectAccessFailure({ project, error: apiErrorMessage(error, 'Failed to load the project') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const changeClusterMember$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(setClusterMember, removeClusterMember),
      concatMap((action) =>
        (action.type === setClusterMember.type
          ? service.setClusterMember(action.userId, action.role)
          : service.removeClusterMember(action.userId)
        ).pipe(
          mergeMap(() => [accessChangeSuccess(), loadClusterMembers()]),
          catchError((error: unknown) =>
            of(accessChangeFailure({ error: apiErrorMessage(error, 'Failed to change the cluster member') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const changeProjectMember$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(setProjectMember, removeProjectMember),
      concatMap((action) =>
        (action.type === setProjectMember.type
          ? service.setMember(action.project, action.userId, action.role)
          : service.removeMember(action.project, action.userId)
        ).pipe(
          mergeMap(() => [accessChangeSuccess(), loadProjectAccess({ project: action.project, silent: true })]),
          catchError((error: unknown) =>
            of(accessChangeFailure({ error: apiErrorMessage(error, 'Failed to change the project member') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const updateProjectSettings$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(updateProjectSettings),
      concatMap(({ project, patch }) =>
        service.updateSettings(project, patch).pipe(
          map((settings) => updateProjectSettingsSuccess({ settings: { ...settings, project } })),
          catchError((error: unknown) =>
            of(accessChangeFailure({ error: apiErrorMessage(error, 'Failed to update the project settings') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const acceptCrossProjectRequest$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(acceptCrossProjectRequest),
      concatMap(({ project, request }) =>
        service.accept(project, request).pipe(
          mergeMap(() => [accessChangeSuccess(), loadProjectAccess({ project, silent: true })]),
          catchError((error: unknown) =>
            of(accessChangeFailure({ error: apiErrorMessage(error, 'Failed to accept the request') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const exportAccess$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService)) =>
    actions$.pipe(
      ofType(exportAccess),
      exhaustMap(({ target }) =>
        service.exportAccess().pipe(
          map((yaml) => exportAccessSuccess({ yaml, target })),
          catchError((error: unknown) =>
            of(exportAccessFailure({ error: apiErrorMessage(error, 'Failed to export access') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

/** Imports, then reloads cluster members and the project shown (both may have changed). */
export const importAccess$ = createEffect(
  (actions$ = inject(Actions), service = inject(AccessManagementService), store = inject(Store)) =>
    actions$.pipe(
      ofType(importAccess),
      exhaustMap(({ yaml }) =>
        service.importAccess(yaml).pipe(
          switchMap((result) =>
            store.select(selectAccessProject).pipe(
              take(1),
              mergeMap((project) => [
                importAccessSuccess({ result }),
                loadClusterMembers(),
                ...(project ? [loadProjectAccess({ project, silent: true })] : []),
              ]),
            ),
          ),
          catchError((error: unknown) =>
            of(importAccessFailure({ error: apiErrorMessage(error, 'Failed to import access') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
