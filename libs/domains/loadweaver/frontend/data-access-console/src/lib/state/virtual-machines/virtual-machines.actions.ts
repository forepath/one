import { createAction, props } from '@ngrx/store';

import type {
  VirtualMachineDetail,
  VirtualMachineSummary,
  VmAction,
  VmImageImport,
  VmImageImportRequest,
  VmRegistryImage,
  VmSnapshot,
} from '../../types/virtual-machines.types';

export const loadVirtualMachines = createAction('[ConsoleVms] Load', props<{ silent?: boolean }>());
export const loadVirtualMachinesSuccess = createAction(
  '[ConsoleVms] Load Success',
  props<{ vms: VirtualMachineSummary[] }>(),
);
export const loadVirtualMachinesFailure = createAction('[ConsoleVms] Load Failure', props<{ error: string }>());

export const loadVirtualMachine = createAction(
  '[ConsoleVms] Load VM',
  props<{ project: string; name: string; silent?: boolean }>(),
);
export const loadVirtualMachineSuccess = createAction(
  '[ConsoleVms] Load VM Success',
  props<{ vm: VirtualMachineDetail }>(),
);
export const loadVirtualMachineFailure = createAction(
  '[ConsoleVms] Load VM Failure',
  props<{ project: string; name: string; error: string }>(),
);

export const virtualMachineAction = createAction(
  '[ConsoleVms] Action',
  props<{ project: string; name: string; action: VmAction }>(),
);
export const virtualMachineActionSuccess = createAction(
  '[ConsoleVms] Action Success',
  props<{ action: VmAction; vm: VirtualMachineDetail }>(),
);
export const virtualMachineActionFailure = createAction(
  '[ConsoleVms] Action Failure',
  props<{ action: VmAction; error: string }>(),
);
export const clearVirtualMachineActionError = createAction('[ConsoleVms] Clear Action Error');

export const loadVmSnapshots = createAction('[ConsoleVms] Load Snapshots', props<{ project: string; name: string }>());
export const loadVmSnapshotsSuccess = createAction(
  '[ConsoleVms] Load Snapshots Success',
  props<{ project: string; name: string; snapshots: VmSnapshot[] }>(),
);
export const loadVmSnapshotsFailure = createAction('[ConsoleVms] Load Snapshots Failure', props<{ error: string }>());

export const createVmSnapshot = createAction(
  '[ConsoleVms] Create Snapshot',
  props<{ project: string; name: string; description?: string }>(),
);
export const createVmSnapshotSuccess = createAction(
  '[ConsoleVms] Create Snapshot Success',
  props<{ snapshot: VmSnapshot }>(),
);
export const createVmSnapshotFailure = createAction('[ConsoleVms] Create Snapshot Failure', props<{ error: string }>());

export const loadVmImageImports = createAction('[ConsoleVms] Load Image Imports', props<{ project: string }>());
export const loadVmImageImportsSuccess = createAction(
  '[ConsoleVms] Load Image Imports Success',
  props<{ project: string; imports: VmImageImport[] }>(),
);
export const loadVmImageImportsFailure = createAction(
  '[ConsoleVms] Load Image Imports Failure',
  props<{ error: string }>(),
);

export const loadVmRegistryImages = createAction('[ConsoleVms] Load Registry Images', props<{ project: string }>());
export const loadVmRegistryImagesSuccess = createAction(
  '[ConsoleVms] Load Registry Images Success',
  props<{ project: string; images: VmRegistryImage[] }>(),
);
export const loadVmRegistryImagesFailure = createAction(
  '[ConsoleVms] Load Registry Images Failure',
  props<{ project: string; error: string }>(),
);

export const importVmImage = createAction(
  '[ConsoleVms] Import Image',
  props<{ project: string; request: VmImageImportRequest }>(),
);
export const importVmImageSuccess = createAction(
  '[ConsoleVms] Import Image Success',
  props<{ imported: VmImageImport }>(),
);
export const importVmImageFailure = createAction('[ConsoleVms] Import Image Failure', props<{ error: string }>());
export const clearVmImageImportError = createAction('[ConsoleVms] Clear Import Error');
