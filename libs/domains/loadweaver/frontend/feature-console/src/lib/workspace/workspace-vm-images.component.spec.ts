import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleVirtualMachinesFacade,
  VirtualMachinesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverWorkspaceVmImagesComponent } from './workspace-vm-images.component';

const image = (repository: string, tag: string) => ({
  repository,
  tag,
  reference: `registry/${repository}:${tag}`,
  digest: `sha256:${repository}`,
  variants: [{ arch: 'amd64', format: 'qcow2', virtualSize: 1024, firmware: ['uefi'], annotations: {} }],
});

describe('LoadweaverWorkspaceVmImagesComponent (3.38)', () => {
  it('shows the project images and imports as two searchable lanes with tone badges', async () => {
    const facade = facadeStub(
      {
        imports$: [
          {
            id: 'i1',
            reference: 'registry/debian:13',
            url: 'https://example.com/debian.qcow2',
            status: 'running',
            arch: 'amd64',
            firmware: ['uefi'],
            downloadedBytes: 0,
            createdAt: '2026-10-28T10:00:00.000Z',
          },
        ],
        importsLoading$: false,
        importsError$: null,
        importing$: false,
        importError$: null,
        registryImages$: [image('debian', '13'), image('alpine', '3.20')],
        registryImagesLoading$: false,
        registryImagesError$: null,
      },
      ['loadImports', 'loadRegistryImages', 'clearImportError', 'importImage'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverWorkspaceVmImagesComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleVirtualMachinesFacade, useValue: facade },
        {
          provide: ConsoleAccessFacade,
          useValue: accessStub({ userId: 'u', clusterRole: null, projects: { shop: 'admin' } }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverWorkspaceVmImagesComponent);

    fixture.componentRef.setInput('showList', true);
    fixture.componentRef.setInput('fixedProject', 'shop');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;

    expect(facade['loadRegistryImages']).toHaveBeenCalledWith('shop');
    expect(el.querySelector('fpc-panel')).toBeNull();
    expect(el.querySelectorAll('[data-testid="vms-registry-images"] tr.fpc-data-table__row')).toHaveLength(2);
    expect(
      el.querySelector('[data-testid="vms-imports"] [data-testid="fpc-data-table-state"]')?.getAttribute('aria-label'),
    ).toBe('Importing');
    expect(el.querySelector('[data-testid="vms-registry-images"] fpc-lane-header fpc-badge')).toBeNull();
    expect(el.querySelector('fpc-status-badge')).toBeNull();
    expect(el.querySelector('[data-testid="workspace-vm-images-project"]')).toBeNull();

    fixture.componentInstance.imagesSearch.set('alpine');
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="vms-registry-images"] tr.fpc-data-table__row')).toHaveLength(1);
  });

  describe('imports (3.42: SHA-512, catalog)', () => {
    const SHA512 = 'd'.repeat(128);
    const catalog = [
      {
        id: 'fedora-42-amd64',
        source: 'shipped',
        distro: 'fedora',
        label: 'Fedora 42',
        version: '42',
        arch: 'amd64',
        url: 'https://download.fedoraproject.org/fedora-42.qcow2',
        checksum: { algorithm: 'sha512', value: SHA512 },
        firmware: ['uefi'],
        suggestedRef: 'fedora:42',
      },
      {
        id: 'cluster:company-base-amd64',
        source: 'cluster',
        distro: 'company-base',
        label: 'Company base',
        version: '2026.10',
        arch: 'amd64',
        url: 'https://images.example.com/company-base.qcow2',
        checksum: { algorithm: 'sha256', value: 'e'.repeat(64) },
        suggestedRef: 'company-base:2026.10',
      },
    ];

    function setup(me: AccessMe) {
      const facade = facadeStub(
        {
          imports$: [],
          importsLoading$: false,
          importsError$: null,
          importing$: false,
          importError$: null,
          registryImages$: [image('fedora', '42')],
          registryImagesLoading$: false,
          registryImagesError$: null,
        },
        ['loadImports', 'loadRegistryImages', 'clearImportError', 'importImage'],
      );
      const api = {
        catalog: jest.fn(() => of({ entries: catalog })),
        upstreamCatalog: jest.fn(() => of({ entries: [], warnings: ['rocky: unreachable'] })),
      };

      TestBed.configureTestingModule({
        imports: [LoadweaverWorkspaceVmImagesComponent],
        providers: [
          provideRouter([]),
          { provide: ConsoleVirtualMachinesFacade, useValue: facade },
          { provide: ConsoleAccessFacade, useValue: accessStub(me) },
          { provide: VirtualMachinesService, useValue: api },
        ],
      });

      const fixture = TestBed.createComponent(LoadweaverWorkspaceVmImagesComponent);

      fixture.componentRef.setInput('showList', true);
      fixture.componentRef.setInput('fixedProject', 'shop');
      fixture.detectChanges();

      return { fixture, facade, api, el: fixture.nativeElement as HTMLElement };
    }

    it('accepts a SHA-512 (or a prefixed SHA-256) in the manual form and sends exactly one checksum field', () => {
      const { fixture, facade } = setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });
      const component = fixture.componentInstance;

      component.openImport();
      component.onImportUrlChange('https://example.com/alma-10.qcow2');
      component.importSha256 = SHA512.toUpperCase();
      component.submitImport();

      expect(component.importInvalid()).toBe(false);
      expect(facade['importImage']).toHaveBeenLastCalledWith('shop', {
        url: 'https://example.com/alma-10.qcow2',
        sha512: SHA512,
        ref: 'alma-10:latest',
        arch: 'amd64',
        firmware: ['uefi'],
        guestAgent: false,
      });

      component.importSha256 = `sha256:${'f'.repeat(64)}`;
      component.submitImport();
      expect((facade['importImage'] as jest.Mock).mock.calls.at(-1)[1]).toMatchObject({ sha256: 'f'.repeat(64) });
      expect((facade['importImage'] as jest.Mock).mock.calls.at(-1)[1].sha512).toBeUndefined();

      component.importSha256 = 'f'.repeat(100);
      component.submitImport();
      expect(component.importInvalid()).toBe(true);
      expect(facade['importImage']).toHaveBeenCalledTimes(2);
    });

    it('imports from the catalog: entries marked, ref prefilled and editable, other versions on demand', () => {
      const { fixture, facade, api, el } = setup({ userId: 'u', clusterRole: null, projects: { shop: 'admin' } });
      const component = fixture.componentInstance;

      expect(api.catalog).not.toHaveBeenCalled();
      (el.querySelector('[data-testid="workspace-vm-catalog"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(api.catalog).toHaveBeenCalledTimes(1);
      expect(component.catalogProject).toBe('shop');
      expect(el.querySelectorAll('[data-testid="vm-catalog-cluster-badge"]')).toHaveLength(1);
      expect(el.querySelectorAll('[data-testid="vm-catalog-present-badge"]')).toHaveLength(1);

      (el.querySelector('[data-testid="vm-catalog-show-other"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(api.upstreamCatalog).toHaveBeenCalledTimes(1);
      expect(el.querySelector('[data-testid="vm-catalog-warnings"]')?.textContent).toContain('rocky');

      component.submitCatalogImport();
      expect(component.catalogInvalid()).toBe(true);

      component.pickCatalogEntry(catalog[0] as never);
      expect(component.catalogRef).toBe('fedora:42');
      component.catalogRef = 'fedora:42-base';
      component.submitCatalogImport();

      expect(facade['importImage']).toHaveBeenCalledWith('shop', {
        url: 'https://download.fedoraproject.org/fedora-42.qcow2',
        sha512: SHA512,
        ref: 'fedora:42-base',
        arch: 'amd64',
        firmware: ['uefi'],
      });
      fixture.destroy();
    });

    it('offers no imports to developers', () => {
      const { el, fixture } = setup({ userId: 'u', clusterRole: null, projects: { shop: 'developer' } });

      expect(fixture.componentInstance.importProjects()).toEqual([]);
      expect(el.querySelector('[data-testid="workspace-vm-catalog"]')).toBeNull();
      expect(el.querySelector('[data-testid="workspace-vm-import"]')).toBeNull();
    });
  });
});
