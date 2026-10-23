import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleVirtualMachinesFacade,
  type VirtualMachineSummary,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverVirtualMachinesPageComponent } from './virtual-machines-page.component';

const vm = (overrides: Partial<VirtualMachineSummary> = {}): VirtualMachineSummary => ({
  project: 'shop',
  name: 'db1',
  labels: {},
  description: null,
  image: 'registry.lw/shop/debian:13',
  pinnedImage: null,
  runStrategy: 'Always',
  power: 'running',
  phase: 'Running',
  node: 'n1',
  vcpus: 2,
  memoryBytes: 4 * 1024 ** 3,
  diskBytes: 20 * 1024 ** 3,
  disks: 1,
  nics: 1,
  addresses: ['10.20.1.5'],
  graphical: true,
  ...overrides,
});

describe('LoadweaverVirtualMachinesPageComponent (3.35)', () => {
  let fixture: ComponentFixture<LoadweaverVirtualMachinesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  beforeEach(async () => {
    facade = facadeStub(
      {
        vms$: [
          vm(),
          vm({ name: 'vpn', project: 'ops', phase: 'Stopped', runStrategy: 'Manual', node: null, addresses: [] }),
        ],
        projects$: ['ops', 'shop'],
        loading$: false,
        error$: null,
        imports$: [],
        importsLoading$: false,
        importsError$: null,
        importing$: false,
        importError$: null,
        registryImages$: [
          {
            project: 'ops',
            repository: 'debian-13',
            tag: '20261017',
            reference: `registry.lw/ops/debian-13:20261017@sha256:${'d'.repeat(64)}`,
            digest: `sha256:${'d'.repeat(64)}`,
            variants: [
              {
                arch: 'amd64',
                format: 'qcow2',
                virtualSize: 3 * 1024 ** 3,
                firmware: ['uefi', 'bios'],
                guestAgent: true,
                layerBytes: 400 * 1024 ** 2,
              },
            ],
          },
        ],
        registryImagesLoading$: false,
        registryImagesError$: null,
      },
      ['load', 'loadImports', 'loadRegistryImages', 'importImage', 'clearImportError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverVirtualMachinesPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: ConsoleVirtualMachinesFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'operator', ops: 'viewer' } }),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverVirtualMachinesPageComponent);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it("shows a VM's boot disk import with a progress bar while the disk is written", () => {
    expect(el().querySelector('[data-testid="vm-import-progress"]')).toBeNull();

    (facade['vms$'] as unknown as { next: (v: VirtualMachineSummary[]) => void }).next([
      vm({
        phase: 'Importing',
        importProgress: { phase: 'writing', bytes: 512 * 1024 ** 2, totalBytes: 2 * 1024 ** 3 },
      }),
      vm({ name: 'web', phase: 'Importing', importProgress: { phase: 'queued' } }),
    ]);
    fixture.detectChanges();

    const rows = el().querySelectorAll('[data-testid="vm-import-progress"]');

    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Writing the boot disk');
    expect(rows[0].textContent).toContain('512.0 MiB / 2.0 GiB');
    expect(rows[0].textContent).toContain('25%');
    expect(rows[0].querySelector('fpc-progress [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      String(512 * 1024 ** 2),
    );
    expect(rows[1].textContent).toContain('Boot disk import queued');
    expect(rows[1].querySelector('fpc-progress')).toBeNull();
  });

  it('lists VMs and filters by phase, run strategy, project and search', () => {
    const component = fixture.componentInstance;

    expect(facade['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="vms-list"]')?.textContent).toContain('db1');
    expect(component.filtered().map((v) => v.name)).toEqual(['vpn', 'db1']);

    component.phase.set('Stopped');
    expect(component.filtered().map((v) => v.name)).toEqual(['vpn']);
    component.clearFilters();
    component.strategy.set('Always');
    expect(component.filtered().map((v) => v.name)).toEqual(['db1']);
    component.clearFilters();
    component.search.set('10.20.1.5');
    expect(component.filtered().map((v) => v.name)).toEqual(['db1']);
    component.search.set('');
    component.project.set('ops');
    fixture.detectChanges();
    expect(facade['loadImports']).toHaveBeenCalledWith('ops');
    expect(facade['loadRegistryImages']).toHaveBeenCalledWith('ops');

    const registry = el().querySelector('[data-testid="vms-registry-images"]')?.textContent ?? '';

    expect(registry).toContain('debian-13:20261017');
    expect(registry).toContain('amd64 · qcow2');
    expect(component.activeFilterCount()).toBe(1);
  });

  it('creates VMs through the resource editor', () => {
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.project.set('shop');
    fixture.componentInstance.create();
    expect(navigate).toHaveBeenCalledWith(['/resources', 'new'], {
      queryParams: { kind: 'VirtualMachine', project: 'shop' },
    });
  });

  it('imports VM images into projects the caller operates, validating the form first', () => {
    const component = fixture.componentInstance;

    expect(component.importProjects()).toEqual(['shop']);
    component.openImport();
    component.onImportUrlChange('https://cloud.example.com/debian-13.qcow2');
    expect(component.importRef).toBe('debian-13:latest');
    component.submitImport();
    expect(component.importInvalid()).toBe(true);
    expect(facade['importImage']).not.toHaveBeenCalled();

    component.importSha256 = 'A'.repeat(64);
    component.submitImport();
    expect(facade['importImage']).toHaveBeenCalledWith('shop', {
      url: 'https://cloud.example.com/debian-13.qcow2',
      sha256: 'a'.repeat(64),
      ref: 'debian-13:latest',
      arch: 'amd64',
      firmware: ['uefi'],
      guestAgent: false,
    });
  });
});
