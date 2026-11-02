import { createReducer, on } from '@ngrx/store';

import type {
  VirtualMachineDetail,
  VirtualMachineSummary,
  VmAction,
  VmImageImport,
  VmRegistryImage,
  VmSnapshot,
} from '../../types/virtual-machines.types';
import {
  clearVirtualMachineActionError,
  clearVmImageImportError,
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
  loadVmImageImportsFailure,
  loadVmImageImportsSuccess,
  loadVmRegistryImages,
  loadVmRegistryImagesFailure,
  loadVmRegistryImagesSuccess,
  loadVmSnapshots,
  loadVmSnapshotsFailure,
  loadVmSnapshotsSuccess,
  virtualMachineAction,
  virtualMachineActionFailure,
  virtualMachineActionSuccess,
} from './virtual-machines.actions';

export interface ConsoleVirtualMachinesState {
  vms: VirtualMachineSummary[];
  loading: boolean;
  error: string | null;
  /** `<project>/<name>` of the open VM. */
  selectedKey: string | null;
  selected: VirtualMachineDetail | null;
  selectedLoading: boolean;
  selectedError: string | null;
  acting: VmAction | null;
  actionError: string | null;
  snapshots: VmSnapshot[];
  snapshotsLoading: boolean;
  snapshotsError: string | null;
  creatingSnapshot: boolean;
  /** The project the imports belong to. */
  importsProject: string | null;
  imports: VmImageImport[];
  importsLoading: boolean;
  importsError: string | null;
  importing: boolean;
  importError: string | null;
  /** VM image artifacts in the registry of `registryProject` (CLI pushes next to imports). */
  registryProject: string | null;
  registryImages: VmRegistryImage[];
  registryImagesLoading: boolean;
  registryImagesError: string | null;
}

export const initialConsoleVirtualMachinesState: ConsoleVirtualMachinesState = {
  vms: [],
  loading: false,
  error: null,
  selectedKey: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  acting: null,
  actionError: null,
  snapshots: [],
  snapshotsLoading: false,
  snapshotsError: null,
  creatingSnapshot: false,
  importsProject: null,
  imports: [],
  importsLoading: false,
  importsError: null,
  importing: false,
  importError: null,
  registryProject: null,
  registryImages: [],
  registryImagesLoading: false,
  registryImagesError: null,
};

export const vmKey = (project: string, name: string) => `${project}/${name}`;

/** The list entry of a detail (the list shows the summary fields). */
function withVm(state: ConsoleVirtualMachinesState, vm: VirtualMachineDetail): ConsoleVirtualMachinesState {
  const key = vmKey(vm.project, vm.name);

  return {
    ...state,
    vms: state.vms.map((v) => (vmKey(v.project, v.name) === key ? { ...v, ...summaryOf(vm) } : v)),
    selected: state.selectedKey === key ? vm : state.selected,
  };
}

function summaryOf(vm: VirtualMachineDetail): VirtualMachineSummary {
  return {
    project: vm.project,
    name: vm.name,
    labels: vm.labels,
    description: vm.description,
    image: vm.image,
    pinnedImage: vm.pinnedImage,
    runStrategy: vm.runStrategy,
    power: vm.power,
    phase: vm.phase,
    node: vm.node,
    vcpus: vm.vcpus,
    memoryBytes: vm.memoryBytes,
    diskBytes: vm.diskBytes,
    disks: vm.disks,
    nics: vm.nics,
    addresses: vm.addresses,
    graphical: vm.graphical,
    ...(vm.invalid ? { invalid: vm.invalid } : {}),
  };
}

export const consoleVirtualMachinesReducer = createReducer(
  initialConsoleVirtualMachinesState,
  on(loadVirtualMachines, (state, { silent }) => ({ ...state, loading: !silent, error: null })),
  on(loadVirtualMachinesSuccess, (state, { vms }) => ({ ...state, vms, loading: false })),
  on(loadVirtualMachinesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadVirtualMachine, (state, { project, name, silent }) => {
    const key = vmKey(project, name);
    const same = state.selectedKey === key;

    return {
      ...state,
      selectedKey: key,
      selected: same ? state.selected : null,
      selectedLoading: !silent,
      selectedError: null,
      actionError: same ? state.actionError : null,
      snapshots: same ? state.snapshots : [],
    };
  }),
  on(loadVirtualMachineSuccess, (state, { vm }) =>
    state.selectedKey === vmKey(vm.project, vm.name)
      ? { ...withVm(state, vm), selectedLoading: false }
      : withVm(state, vm),
  ),
  on(loadVirtualMachineFailure, (state, { project, name, error }) =>
    state.selectedKey === vmKey(project, name) ? { ...state, selectedLoading: false, selectedError: error } : state,
  ),
  on(virtualMachineAction, (state, { action }) => ({ ...state, acting: action, actionError: null })),
  on(virtualMachineActionSuccess, (state, { vm }) => ({ ...withVm(state, vm), acting: null })),
  on(virtualMachineActionFailure, (state, { error }) => ({ ...state, acting: null, actionError: error })),
  on(clearVirtualMachineActionError, (state) => ({ ...state, actionError: null })),
  on(loadVmSnapshots, (state) => ({ ...state, snapshotsLoading: true, snapshotsError: null })),
  on(loadVmSnapshotsSuccess, (state, { project, name, snapshots }) =>
    state.selectedKey === vmKey(project, name) ? { ...state, snapshots, snapshotsLoading: false } : state,
  ),
  on(loadVmSnapshotsFailure, (state, { error }) => ({ ...state, snapshotsLoading: false, snapshotsError: error })),
  on(createVmSnapshot, (state) => ({ ...state, creatingSnapshot: true, snapshotsError: null })),
  on(createVmSnapshotSuccess, (state, { snapshot }) => ({
    ...state,
    creatingSnapshot: false,
    snapshots:
      state.selectedKey === vmKey(snapshot.project, snapshot.name) ? [snapshot, ...state.snapshots] : state.snapshots,
  })),
  on(createVmSnapshotFailure, (state, { error }) => ({ ...state, creatingSnapshot: false, snapshotsError: error })),
  on(loadVmImageImports, (state, { project }) => ({
    ...state,
    importsProject: project,
    imports: state.importsProject === project ? state.imports : [],
    importsLoading: true,
    importsError: null,
  })),
  on(loadVmImageImportsSuccess, (state, { project, imports }) =>
    state.importsProject === project ? { ...state, imports, importsLoading: false } : state,
  ),
  on(loadVmImageImportsFailure, (state, { error }) => ({ ...state, importsLoading: false, importsError: error })),
  on(loadVmRegistryImages, (state, { project }) => ({
    ...state,
    registryProject: project,
    registryImages: state.registryProject === project ? state.registryImages : [],
    registryImagesLoading: true,
    registryImagesError: null,
  })),
  on(loadVmRegistryImagesSuccess, (state, { project, images }) =>
    state.registryProject === project ? { ...state, registryImages: images, registryImagesLoading: false } : state,
  ),
  on(loadVmRegistryImagesFailure, (state, { project, error }) =>
    state.registryProject === project ? { ...state, registryImagesLoading: false, registryImagesError: error } : state,
  ),
  on(importVmImage, (state) => ({ ...state, importing: true, importError: null })),
  on(importVmImageSuccess, (state, { imported }) => ({
    ...state,
    importing: false,
    imports: state.importsProject === imported.project ? [imported, ...state.imports] : state.imports,
  })),
  on(importVmImageFailure, (state, { error }) => ({ ...state, importing: false, importError: error })),
  on(clearVmImageImportError, (state) => ({ ...state, importError: null })),
);
