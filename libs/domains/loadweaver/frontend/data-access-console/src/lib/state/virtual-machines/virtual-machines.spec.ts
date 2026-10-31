import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { firstValueFrom, of, throwError, toArray } from 'rxjs';

import { VirtualMachinesService } from '../../services/virtual-machines.service';
import type { VirtualMachineDetail, VirtualMachineSummary, VmSnapshot } from '../../types/virtual-machines.types';
import {
  createVmSnapshotSuccess,
  importVmImageSuccess,
  loadVirtualMachine,
  loadVirtualMachinesSuccess,
  loadVmImageImports,
  loadVmRegistryImages,
  loadVmRegistryImagesFailure,
  loadVmRegistryImagesSuccess,
  loadVmSnapshotsSuccess,
  virtualMachineAction,
  virtualMachineActionFailure,
  virtualMachineActionSuccess,
} from './virtual-machines.actions';
import { loadVmRegistryImages$, virtualMachineActions$ } from './virtual-machines.effects';
import { consoleVirtualMachinesReducer, initialConsoleVirtualMachinesState } from './virtual-machines.reducer';
import { selectVirtualMachineProjects } from './virtual-machines.selectors';

function vmSummary(overrides: Partial<VirtualMachineSummary> = {}): VirtualMachineSummary {
  return {
    project: 'shop',
    name: 'db1',
    labels: { app: 'db' },
    description: null,
    image: 'registry.lw/shop/debian:13',
    pinnedImage: null,
    runStrategy: 'Manual',
    power: 'running',
    phase: 'Running',
    node: 'n1',
    vcpus: 2,
    memoryBytes: 4 * 1024 ** 3,
    diskBytes: 120 * 1024 ** 3,
    disks: 2,
    nics: 1,
    addresses: ['10.20.1.5'],
    graphical: true,
    ...overrides,
  };
}

function vmDetail(overrides: Partial<VirtualMachineDetail> = {}): VirtualMachineDetail {
  return {
    ...vmSummary(),
    spec: { image: 'registry.lw/shop/debian:13' },
    generation: 1,
    updatedAt: '2026-10-23T10:00:00.000Z',
    status: {
      phase: 'Running',
      node: 'n1',
      state: 'running',
      guestPower: 'running',
      importing: false,
      message: null,
      exitCode: null,
      reportedAt: '2026-10-23T10:00:00.000Z',
      lastBoot: '2026-10-23T10:00:00.000Z',
      migration: null,
    },
    powerDetail: { graceful: true, changedBy: null, changedAt: null, instanceGeneration: 1 },
    nicStatus: [
      {
        name: 'eth0',
        index: 0,
        primary: true,
        mac: '52:54:00:aa:bb:cc',
        groups: ['db'],
        labels: {},
        families: ['v4'],
        addresses: ['10.20.1.5'],
      },
    ],
    diskStatus: [
      {
        name: 'root',
        volume: 'shop/lw-vm/db1.root',
        source: 'image',
        boot: true,
        sizeBytes: 20 * 1024 ** 3,
        bus: 'virtio',
        cache: 'none',
        replicas: 2,
        crossSite: null,
        primaryNode: 'n1',
        syncReplicas: ['n2'],
        remoteReplicas: [],
      },
    ],
    consoles: {
      replica: 'shop/lw-vm/db1/0',
      namespace: 'socket/consoles',
      serial: { available: true },
      vnc: { available: true },
    },
    actions: ['stop', 'force-off', 'shutdown', 'reboot', 'reset'],
    permissions: { power: true, snapshot: true, console: true, edit: true },
    commands: [],
    ...overrides,
  };
}

const snapshot: VmSnapshot = {
  id: 's1',
  project: 'shop',
  name: 'db1',
  description: null,
  consistency: 'crash',
  status: 'running',
  createdBy: 'user:u1',
  createdAt: '2026-10-23T10:00:00.000Z',
  disks: [],
};

describe('console virtual machines state (3.35)', () => {
  it('lists projects, opens a VM and applies action answers to list and detail', () => {
    const listed = consoleVirtualMachinesReducer(
      initialConsoleVirtualMachinesState,
      loadVirtualMachinesSuccess({ vms: [vmSummary(), vmSummary({ project: 'ops', name: 'vpn' })] }),
    );

    expect(selectVirtualMachineProjects({ consoleVirtualMachines: listed })).toEqual(['ops', 'shop']);

    const opened = consoleVirtualMachinesReducer(listed, loadVirtualMachine({ project: 'shop', name: 'db1' }));
    const acting = consoleVirtualMachinesReducer(
      opened,
      virtualMachineAction({ project: 'shop', name: 'db1', action: 'stop' }),
    );
    const done = consoleVirtualMachinesReducer(
      acting,
      virtualMachineActionSuccess({ action: 'stop', vm: vmDetail({ phase: 'Stopping', power: 'stopped' }) }),
    );

    expect(opened.selectedKey).toBe('shop/db1');
    expect(acting.acting).toBe('stop');
    expect(done.selected?.phase).toBe('Stopping');
    expect(done.vms[0]).toMatchObject({ phase: 'Stopping', power: 'stopped' });
    expect(done.vms[0]).not.toHaveProperty('nicStatus');
    expect(
      consoleVirtualMachinesReducer(acting, virtualMachineActionFailure({ action: 'stop', error: 'managed by spec' })),
    ).toMatchObject({ acting: null, actionError: 'managed by spec' });
  });

  it('keeps snapshots and imports per VM / project', () => {
    const opened = consoleVirtualMachinesReducer(
      initialConsoleVirtualMachinesState,
      loadVirtualMachine({ project: 'shop', name: 'db1' }),
    );
    const loaded = consoleVirtualMachinesReducer(
      opened,
      loadVmSnapshotsSuccess({ project: 'shop', name: 'db1', snapshots: [] }),
    );
    const taken = consoleVirtualMachinesReducer(loaded, createVmSnapshotSuccess({ snapshot }));

    expect(taken.snapshots).toEqual([snapshot]);
    expect(
      consoleVirtualMachinesReducer(taken, loadVmSnapshotsSuccess({ project: 'shop', name: 'other', snapshots: [] }))
        .snapshots,
    ).toEqual([snapshot]);

    const imports = consoleVirtualMachinesReducer(taken, loadVmImageImports({ project: 'shop' }));
    const imported = consoleVirtualMachinesReducer(
      imports,
      importVmImageSuccess({ imported: { id: 'i1', project: 'shop' } as never }),
    );

    expect(imported.imports.map((i) => i.id)).toEqual(['i1']);
    expect(
      consoleVirtualMachinesReducer(imports, importVmImageSuccess({ imported: { id: 'i2', project: 'ops' } as never }))
        .imports,
    ).toEqual([]);
  });

  it('runs actions and reports conflicts', async () => {
    const service = {
      act: jest
        .fn()
        .mockReturnValueOnce(of(vmDetail()))
        .mockReturnValueOnce(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 409,
                error: { message: 'power is managed by the spec (runStrategy: Always)' },
              }),
          ),
        ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() =>
          of(
            virtualMachineAction({ project: 'shop', name: 'db1', action: 'reboot' }),
            virtualMachineAction({ project: 'shop', name: 'db2', action: 'stop' }),
          ),
        ),
      ],
    });

    expect(
      await firstValueFrom(
        virtualMachineActions$(TestBed.inject(Actions), service as unknown as VirtualMachinesService).pipe(toArray()),
      ),
    ).toEqual([
      virtualMachineActionSuccess({ action: 'reboot', vm: vmDetail() }),
      virtualMachineActionFailure({ action: 'stop', error: 'power is managed by the spec (runStrategy: Always)' }),
    ]);
    expect(service.act).toHaveBeenCalledWith('shop', 'db1', 'reboot');
  });

  it('loads the registry VM images per project and ignores answers of another project', async () => {
    const image = {
      project: 'shop',
      repository: 'debian-13',
      tag: '1',
      reference: `registry.lw/shop/debian-13:1@sha256:${'a'.repeat(64)}`,
      digest: `sha256:${'a'.repeat(64)}`,
      variants: [
        {
          arch: 'amd64' as const,
          format: 'raw' as const,
          virtualSize: 1024,
          firmware: ['uefi' as const],
          guestAgent: false,
          layerBytes: 100,
        },
      ],
    };
    let state = consoleVirtualMachinesReducer(
      initialConsoleVirtualMachinesState,
      loadVmRegistryImages({ project: 'shop' }),
    );

    expect(state.registryImagesLoading).toBe(true);
    state = consoleVirtualMachinesReducer(state, loadVmRegistryImagesSuccess({ project: 'ops', images: [image] }));
    expect(state.registryImages).toEqual([]);
    state = consoleVirtualMachinesReducer(state, loadVmRegistryImagesSuccess({ project: 'shop', images: [image] }));
    expect(state.registryImages).toEqual([image]);
    expect(state.registryImagesLoading).toBe(false);
    state = consoleVirtualMachinesReducer(state, loadVmRegistryImagesFailure({ project: 'shop', error: 'down' }));
    expect(state.registryImagesError).toBe('down');

    const service = { registryImages: jest.fn().mockReturnValue(of([image])) };

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => of(loadVmRegistryImages({ project: 'shop' })))],
    });
    expect(
      await firstValueFrom(
        loadVmRegistryImages$(TestBed.inject(Actions), service as unknown as VirtualMachinesService).pipe(toArray()),
      ),
    ).toEqual([loadVmRegistryImagesSuccess({ project: 'shop', images: [image] })]);
  });
});
