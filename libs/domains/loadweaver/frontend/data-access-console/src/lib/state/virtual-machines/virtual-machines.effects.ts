import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, concatMap, exhaustMap, map, mergeMap, of, switchMap } from 'rxjs';

import { VirtualMachinesService } from '../../services/virtual-machines.service';
import { apiErrorMessage } from '../../utils/api-error';
import {
  createVmSnapshot,
  createVmSnapshotFailure,
  createVmSnapshotSuccess,
  importVmImage,
  importVmImageFailure,
  importVmImageSuccess,
  loadVirtualMachine,
  loadVirtualMachineFailure,
  loadVirtualMachines,
  loadVirtualMachinesFailure,
  loadVirtualMachinesSuccess,
  loadVirtualMachineSuccess,
  loadVmImageImports,
  loadVmRegistryImages,
  loadVmRegistryImagesFailure,
  loadVmRegistryImagesSuccess,
  loadVmImageImportsFailure,
  loadVmImageImportsSuccess,
  loadVmSnapshots,
  loadVmSnapshotsFailure,
  loadVmSnapshotsSuccess,
  virtualMachineAction,
  virtualMachineActionFailure,
  virtualMachineActionSuccess,
} from './virtual-machines.actions';

export const loadVirtualMachines$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(loadVirtualMachines),
      switchMap(() =>
        service.list().pipe(
          map((vms) => loadVirtualMachinesSuccess({ vms })),
          catchError((error: unknown) =>
            of(loadVirtualMachinesFailure({ error: apiErrorMessage(error, 'Failed to load virtual machines') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadVirtualMachine$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(loadVirtualMachine),
      switchMap(({ project, name }) =>
        service.get(project, name).pipe(
          map((vm) => loadVirtualMachineSuccess({ vm })),
          catchError((error: unknown) =>
            of(
              loadVirtualMachineFailure({
                project,
                name,
                error: apiErrorMessage(error, 'Failed to load the virtual machine'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const virtualMachineActions$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(virtualMachineAction),
      concatMap(({ project, name, action }) =>
        service.act(project, name, action).pipe(
          map((vm) => virtualMachineActionSuccess({ action, vm })),
          catchError((error: unknown) =>
            of(virtualMachineActionFailure({ action, error: apiErrorMessage(error, `Failed to ${action} the VM`) })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadVmSnapshots$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(loadVmSnapshots),
      switchMap(({ project, name }) =>
        service.snapshots(project, name).pipe(
          map((snapshots) => loadVmSnapshotsSuccess({ project, name, snapshots })),
          catchError((error: unknown) =>
            of(loadVmSnapshotsFailure({ error: apiErrorMessage(error, 'Failed to load snapshots') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const createVmSnapshot$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(createVmSnapshot),
      exhaustMap(({ project, name, description }) =>
        service.createSnapshot(project, name, description).pipe(
          map((snapshot) => createVmSnapshotSuccess({ snapshot })),
          catchError((error: unknown) =>
            of(createVmSnapshotFailure({ error: apiErrorMessage(error, 'Failed to take the snapshot') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadVmImageImports$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(loadVmImageImports),
      switchMap(({ project }) =>
        service.imageImports(project).pipe(
          map((imports) => loadVmImageImportsSuccess({ project, imports })),
          catchError((error: unknown) =>
            of(loadVmImageImportsFailure({ error: apiErrorMessage(error, 'Failed to load VM image imports') })),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const loadVmRegistryImages$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(loadVmRegistryImages),
      switchMap(({ project }) =>
        service.registryImages(project).pipe(
          map((images) => loadVmRegistryImagesSuccess({ project, images })),
          catchError((error: unknown) =>
            of(
              loadVmRegistryImagesFailure({
                project,
                error: apiErrorMessage(error, 'Failed to load the VM images of the registry'),
              }),
            ),
          ),
        ),
      ),
    ),
  { functional: true },
);

export const importVmImage$ = createEffect(
  (actions$ = inject(Actions), service = inject(VirtualMachinesService)) =>
    actions$.pipe(
      ofType(importVmImage),
      mergeMap(({ project, request }) =>
        service.importImage(project, request).pipe(
          map((imported) => importVmImageSuccess({ imported })),
          catchError((error: unknown) =>
            of(importVmImageFailure({ error: apiErrorMessage(error, 'Failed to start the import') })),
          ),
        ),
      ),
    ),
  { functional: true },
);
