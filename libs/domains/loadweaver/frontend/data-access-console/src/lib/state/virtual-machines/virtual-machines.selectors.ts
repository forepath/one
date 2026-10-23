import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ConsoleVirtualMachinesState } from './virtual-machines.reducer';

export const selectConsoleVirtualMachinesState =
  createFeatureSelector<ConsoleVirtualMachinesState>('consoleVirtualMachines');

const pick = <K extends keyof ConsoleVirtualMachinesState>(key: K) =>
  createSelector(selectConsoleVirtualMachinesState, (state) => state[key]);

export const selectVirtualMachines = pick('vms');
export const selectVirtualMachinesLoading = pick('loading');
export const selectVirtualMachinesError = pick('error');
export const selectSelectedVirtualMachine = pick('selected');
export const selectSelectedVirtualMachineLoading = pick('selectedLoading');
export const selectSelectedVirtualMachineError = pick('selectedError');
export const selectVirtualMachineActing = pick('acting');
export const selectVirtualMachineActionError = pick('actionError');
export const selectVmSnapshots = pick('snapshots');
export const selectVmSnapshotsLoading = pick('snapshotsLoading');
export const selectVmSnapshotsError = pick('snapshotsError');
export const selectCreatingVmSnapshot = pick('creatingSnapshot');
export const selectVmImageImports = pick('imports');
export const selectVmImageImportsLoading = pick('importsLoading');
export const selectVmImageImportsError = pick('importsError');
export const selectImportingVmImage = pick('importing');
export const selectVmImageImportError = pick('importError');
export const selectVmRegistryImages = pick('registryImages');
export const selectVmRegistryImagesLoading = pick('registryImagesLoading');
export const selectVmRegistryImagesError = pick('registryImagesError');

/** Projects that have VMs (for the project filter), sorted. */
export const selectVirtualMachineProjects = createSelector(selectVirtualMachines, (vms) =>
  [...new Set(vms.map((v) => v.project))].sort(),
);
