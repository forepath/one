import { TestBed } from '@angular/core/testing';
import {
  type AccessMe,
  ConsoleAccessFacade,
  type VmImageCatalogEntry,
  VirtualMachinesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import { accessStub } from '../testing';
import { LoadweaverVmRecommendedImagesComponent } from './vm-recommended-images.component';

const entry = (overrides: Partial<VmImageCatalogEntry> = {}): VmImageCatalogEntry => ({
  id: 'debian-13-amd64',
  source: 'shipped',
  distro: 'debian',
  label: 'Debian 13',
  version: '13',
  arch: 'amd64',
  url: 'https://cloud.debian.org/images/cloud/trixie/latest/debian-13-generic-amd64.qcow2',
  checksum: { algorithm: 'sha512', value: 'c'.repeat(128) },
  suggestedRef: 'debian:13',
  ...overrides,
});

describe('LoadweaverVmRecommendedImagesComponent (3.42)', () => {
  function setup(me: AccessMe | null, registry: unknown[] = []) {
    const api = {
      catalog: jest.fn(() => of({ entries: [entry()] })),
      upstreamCatalog: jest.fn(() => of({ entries: [], warnings: [] })),
      registryImages: jest.fn(() => of(registry)),
      importImage: jest.fn(() =>
        of({ reference: 'registry.lw/shop/debian:13', status: 'pending', project: 'shop' } as unknown),
      ),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverVmRecommendedImagesComponent],
      providers: [
        { provide: VirtualMachinesService, useValue: api },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    });

    const fixture = TestBed.createComponent(LoadweaverVmRecommendedImagesComponent);
    const filled: string[] = [];

    fixture.componentRef.setInput('project', 'shop');
    fixture.componentInstance.imageChange.subscribe((ref) => filled.push(ref));
    fixture.detectChanges();

    return { fixture, api, filled, component: fixture.componentInstance };
  }

  it('loads nothing until opened; then the catalog and the project registry', () => {
    const { fixture, api } = setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    expect(api.catalog).not.toHaveBeenCalled();
    expect(api.registryImages).not.toHaveBeenCalled();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="vm-recommended-toggle"] button')
      ?.click();
    fixture.detectChanges();

    expect(api.catalog).toHaveBeenCalledTimes(1);
    expect(api.registryImages).toHaveBeenCalledWith('shop');
    expect(api.upstreamCatalog).not.toHaveBeenCalled();
  });

  it('fills an image the project already has, without importing', async () => {
    const { api, filled, component } = setup({ userId: 'u', clusterRole: null, projects: { shop: 'viewer' } }, [
      { repository: 'debian', tag: '13', reference: 'registry.lw/shop/debian:13@sha256:abc', variants: [] },
    ]);

    await component.pick(entry());

    expect(api.importImage).not.toHaveBeenCalled();
    expect(filled).toEqual(['registry.lw/shop/debian:13']);
    expect(component.notice()).toEqual({ type: 'filled', reference: 'registry.lw/shop/debian:13' });
  });

  it('imports a missing image with its SHA-512 and fills the reference it gets', async () => {
    const { api, filled, component } = setup({ userId: 'u', clusterRole: null, projects: { shop: 'operator' } });

    await component.pick(entry());

    expect(api.importImage).toHaveBeenCalledWith('shop', {
      url: entry().url,
      sha512: 'c'.repeat(128),
      ref: 'debian:13',
      arch: 'amd64',
    });
    expect(filled).toEqual(['registry.lw/shop/debian:13']);
    expect(component.notice()?.type).toBe('importing');
  });

  it('explains instead of importing without operator / admin in the project', async () => {
    const { api, filled, component, fixture } = setup({
      userId: 'u',
      clusterRole: null,
      projects: { shop: 'developer' },
    });

    expect(component.mayImport()).toBe(false);
    await component.pick(entry());
    fixture.detectChanges();

    expect(api.importImage).not.toHaveBeenCalled();
    expect(filled).toEqual([]);
    expect(component.noticeText()).toContain('debian:13');
    expect(component.noticeText()).toContain('shop');
  });

  it('shows a failed import start', async () => {
    const { api, filled, component } = setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    api.importImage.mockReturnValueOnce(throwError(() => new Error('quota exceeded')));
    await component.pick(entry());

    expect(filled).toEqual([]);
    expect(component.notice()?.type).toBe('error');
  });
});
