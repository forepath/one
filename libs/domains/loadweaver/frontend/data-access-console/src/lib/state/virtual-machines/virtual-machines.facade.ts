import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { VmAction, VmImageImportRequest } from '../../types/virtual-machines.types';
import {
  clearVirtualMachineActionError,
  clearVmImageImportError,
  createVmSnapshot,
  importVmImage,
  loadVirtualMachine,
  loadVirtualMachines,
  loadVmImageImports,
  loadVmRegistryImages,
  loadVmSnapshots,
  virtualMachineAction,
} from './virtual-machines.actions';
import {
  selectCreatingVmSnapshot,
  selectImportingVmImage,
  selectSelectedVirtualMachine,
  selectSelectedVirtualMachineError,
  selectSelectedVirtualMachineLoading,
  selectVirtualMachineActing,
  selectVirtualMachineActionError,
  selectVirtualMachineProjects,
  selectVirtualMachines,
  selectVirtualMachinesError,
  selectVirtualMachinesLoading,
  selectVmImageImportError,
  selectVmImageImports,
  selectVmImageImportsError,
  selectVmImageImportsLoading,
  selectVmRegistryImages,
  selectVmRegistryImagesError,
  selectVmRegistryImagesLoading,
  selectVmSnapshots,
  selectVmSnapshotsError,
  selectVmSnapshotsLoading,
} from './virtual-machines.selectors';

@Injectable()
export class ConsoleVirtualMachinesFacade {
  private readonly store = inject(Store);

  readonly vms$ = this.store.select(selectVirtualMachines);
  readonly projects$ = this.store.select(selectVirtualMachineProjects);
  readonly loading$ = this.store.select(selectVirtualMachinesLoading);
  readonly error$ = this.store.select(selectVirtualMachinesError);
  readonly selected$ = this.store.select(selectSelectedVirtualMachine);
  readonly selectedLoading$ = this.store.select(selectSelectedVirtualMachineLoading);
  readonly selectedError$ = this.store.select(selectSelectedVirtualMachineError);
  readonly acting$ = this.store.select(selectVirtualMachineActing);
  readonly actionError$ = this.store.select(selectVirtualMachineActionError);
  readonly snapshots$ = this.store.select(selectVmSnapshots);
  readonly snapshotsLoading$ = this.store.select(selectVmSnapshotsLoading);
  readonly snapshotsError$ = this.store.select(selectVmSnapshotsError);
  readonly creatingSnapshot$ = this.store.select(selectCreatingVmSnapshot);
  readonly imports$ = this.store.select(selectVmImageImports);
  readonly importsLoading$ = this.store.select(selectVmImageImportsLoading);
  readonly importsError$ = this.store.select(selectVmImageImportsError);
  readonly importing$ = this.store.select(selectImportingVmImage);
  readonly importError$ = this.store.select(selectVmImageImportError);
  readonly registryImages$ = this.store.select(selectVmRegistryImages);
  readonly registryImagesLoading$ = this.store.select(selectVmRegistryImagesLoading);
  readonly registryImagesError$ = this.store.select(selectVmRegistryImagesError);

  /** `silent`: refresh without the loading state. */
  load(silent = false): void {
    this.store.dispatch(loadVirtualMachines({ silent }));
  }

  open(project: string, name: string, silent = false): void {
    this.store.dispatch(loadVirtualMachine({ project, name, silent }));
  }

  act(project: string, name: string, action: VmAction): void {
    this.store.dispatch(virtualMachineAction({ project, name, action }));
  }

  clearActionError(): void {
    this.store.dispatch(clearVirtualMachineActionError());
  }

  loadSnapshots(project: string, name: string): void {
    this.store.dispatch(loadVmSnapshots({ project, name }));
  }

  snapshot(project: string, name: string, description?: string): void {
    this.store.dispatch(createVmSnapshot({ project, name, ...(description ? { description } : {}) }));
  }

  loadImports(project: string): void {
    this.store.dispatch(loadVmImageImports({ project }));
  }

  /** VM image artifacts in the project's registry (CLI pushes and imports). */
  loadRegistryImages(project: string): void {
    this.store.dispatch(loadVmRegistryImages({ project }));
  }

  importImage(project: string, request: VmImageImportRequest): void {
    this.store.dispatch(importVmImage({ project, request }));
  }

  clearImportError(): void {
    this.store.dispatch(clearVmImageImportError());
  }
}
