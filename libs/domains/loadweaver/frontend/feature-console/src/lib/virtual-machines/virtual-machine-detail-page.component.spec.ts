import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleVirtualMachinesFacade,
  type VirtualMachineDetail,
  type VmConsoleSocketEvent,
  VmConsoleSocketClient,
} from '@forepath/loadweaver/frontend/data-access-console';
import { FPC_VNC_RFB_LOADER } from '@forepath/shared/frontend/ui-components';
import { of, Subject } from 'rxjs';

import { facadeStub } from '../testing';
import { LoadweaverVirtualMachineDetailPageComponent } from './virtual-machine-detail-page.component';

const vm: VirtualMachineDetail = {
  project: 'shop',
  name: 'db1',
  labels: { app: 'db' },
  description: 'Primary database',
  image: 'registry.lw/shop/debian:13',
  pinnedImage: 'registry.lw/shop/debian:13@sha256:abc',
  runStrategy: 'Manual',
  power: 'running',
  phase: 'Running',
  node: 'n1',
  vcpus: 2,
  memoryBytes: 4 * 1024 ** 3,
  diskBytes: 120 * 1024 ** 3,
  disks: 2,
  nics: 2,
  addresses: ['10.20.1.5', '10.20.1.6'],
  graphical: true,
  spec: {},
  generation: 3,
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
    {
      name: 'data1',
      index: 1,
      primary: false,
      mac: '52:54:00:dd:ee:ff',
      groups: ['storage'],
      labels: { net: 'storage' },
      families: ['v4'],
      addresses: ['10.20.1.6'],
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
  commands: [
    {
      id: 'c1',
      type: 'vmPower',
      action: 'reboot',
      node: 'n1',
      status: 'sent',
      error: null,
      requestedBy: 'user:u1',
      createdAt: '2026-10-23T09:00:00.000Z',
      sentAt: '2026-10-23T09:00:01.000Z',
    },
  ],
};

class ConsoleClientStub {
  readonly events = new Subject<VmConsoleSocketEvent>();
  readonly events$ = this.events.asObservable();
  connect = jest.fn(async () => true);
  open = jest.fn((_replica: string, kind: string) => (kind === 'serial' ? 's1' : 'v1'));
  input = jest.fn();
  resize = jest.fn();
  close = jest.fn();
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LoadweaverVirtualMachineDetailPageComponent (3.35)', () => {
  let fixture: ComponentFixture<LoadweaverVirtualMachineDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let client: ConsoleClientStub;

  beforeEach(async () => {
    facade = facadeStub(
      {
        selected$: vm,
        selectedLoading$: false,
        selectedError$: null,
        acting$: null,
        actionError$: null,
        snapshots$: [
          {
            id: 's1',
            project: 'shop',
            name: 'db1',
            description: 'before upgrade',
            consistency: 'crash',
            status: 'succeeded',
            createdBy: 'user:u1',
            createdAt: '2026-10-22T10:00:00.000Z',
            disks: [{ disk: 'root', backupId: 'b1', status: 'succeeded', bytes: 1024, error: null, finishedAt: null }],
          },
        ],
        snapshotsError$: null,
        creatingSnapshot$: false,
      },
      ['open', 'act', 'clearActionError', 'loadSnapshots', 'snapshot'],
    );
    client = new ConsoleClientStub();

    await TestBed.configureTestingModule({
      imports: [LoadweaverVirtualMachineDetailPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ project: 'shop', name: 'db1' })),
            queryParamMap: of(convertToParamMap({})),
          },
        },
        { provide: ConsoleVirtualMachinesFacade, useValue: facade },
        { provide: FPC_VNC_RFB_LOADER, useValue: async () => class {} },
      ],
    })
      .overrideComponent(LoadweaverVirtualMachineDetailPageComponent, {
        set: { providers: [{ provide: VmConsoleSocketClient, useValue: client }] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(LoadweaverVirtualMachineDetailPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('opens the VM with its snapshots and shows status, NICs, disks and commands', () => {
    expect(facade['open']).toHaveBeenCalledWith('shop', 'db1');
    expect(facade['loadSnapshots']).toHaveBeenCalledWith('shop', 'db1');
    expect(el().querySelector('[data-testid="vm-status"]')?.textContent).toContain('n1');
    expect(el().querySelector('[data-testid="vm-nics"]')?.textContent).toContain('52:54:00:dd:ee:ff');
    expect(el().querySelector('[data-testid="vm-nics"]')?.textContent).toContain('net=storage');
    expect(el().querySelector('[data-testid="vm-disks"]')?.textContent).toContain('shop/lw-vm/db1.root');
    expect(el().querySelector('[data-testid="vm-snapshots"]')?.textContent).toContain('before upgrade');
    expect(el().querySelector('[data-testid="vm-commands"]')?.textContent).toContain('reboot');
    expect(el().querySelector('[data-testid="vm-edit"]')).not.toBeNull();
  });

  it('shows the boot disk import in the header and the status (download without total: no bar; failure)', () => {
    expect(el().querySelector('[data-testid="vm-import-progress"]')).toBeNull();

    const selected = facade['selected$'] as unknown as { next: (v: VirtualMachineDetail) => void };
    const importing = (progress: NonNullable<VirtualMachineDetail['status']['importProgress']>) =>
      selected.next({
        ...vm,
        phase: 'Importing',
        status: { ...vm.status, phase: 'Importing', importing: progress.phase !== 'failed', importProgress: progress },
      });

    importing({ phase: 'writing', bytes: 3 * 1024 ** 3, totalBytes: 4 * 1024 ** 3 });
    fixture.detectChanges();

    const status = el().querySelector('[data-testid="vm-status"]');

    expect(el().querySelectorAll('[data-testid="vm-import-progress"]')).toHaveLength(2);
    expect(status?.textContent).toContain('Boot disk');
    expect(status?.textContent).toContain('Writing the boot disk');
    expect(status?.textContent).toContain('3.0 GiB / 4.0 GiB');
    expect(status?.textContent).toContain('75%');
    expect(status?.querySelector('fpc-progress')).not.toBeNull();

    importing({ phase: 'fetching', bytes: 100 * 1024 ** 2 });
    fixture.detectChanges();
    expect(status?.textContent).toContain('Downloading the image');
    expect(status?.textContent).toContain('100.0 MiB');
    expect(status?.querySelector('fpc-progress')).toBeNull();

    importing({ phase: 'failed' });
    fixture.detectChanges();
    expect(status?.textContent).toContain('Boot disk import failed (retried)');
    expect(status?.querySelector('[data-testid="vm-import-progress"] .text-danger')).not.toBeNull();
  });

  it('offers the power actions the API allows and runs one after confirmation', () => {
    const component = fixture.componentInstance;

    expect(component.powerActions()).toEqual(['shutdown', 'stop', 'reboot', 'reset', 'force-off']);
    expect(el().querySelector('[data-testid="vm-action-reimage"]')).toBeNull();

    component.ask('force-off');
    expect(component.confirmDanger()).toBe(true);
    expect(facade['act']).not.toHaveBeenCalled();
    component.confirm();
    expect(facade['act']).toHaveBeenCalledWith('shop', 'db1', 'force-off');

    component.ask('reboot');
    component.onConfirmOpenChange(false);
    component.confirm();
    expect(facade['act']).toHaveBeenCalledTimes(1);
  });

  it('opens the serial console on its tab and relays text both ways', async () => {
    fixture.componentInstance.selectTab('serial');
    fixture.detectChanges();
    await flush();

    expect(client.connect).toHaveBeenCalled();
    expect(client.open).toHaveBeenCalledWith('shop/lw-vm/db1/0', 'serial', undefined);

    client.events.next({ type: 'opened', sessionId: 's1', kind: 'serial', recorded: true });
    fixture.detectChanges();
    expect(el().textContent).toContain('Recorded');
  });

  it('opens the graphical console through a channel adapter', async () => {
    fixture.componentInstance.selectTab('vnc');
    fixture.detectChanges();
    await flush();

    expect(client.open).toHaveBeenCalledWith('shop/lw-vm/db1/0', 'vnc');
  });

  it('takes a snapshot with a description', () => {
    const component = fixture.componentInstance;

    component.openSnapshot();
    component.snapshotDescription = ' nightly ';
    component.takeSnapshot();
    expect(facade['snapshot']).toHaveBeenCalledWith('shop', 'db1', 'nightly');
  });
});
