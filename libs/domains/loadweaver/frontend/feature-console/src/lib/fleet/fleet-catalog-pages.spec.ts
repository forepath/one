import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  FleetCatalogService,
  type FleetCatalogInfo,
  type FleetCatalogPackage,
  type FleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of, throwError } from 'rxjs';

import {
  fleetCatalogPackageState,
  LoadweaverFleetCatalogPageComponent,
  shortDigest,
  uploadErrorDetails,
} from './fleet-catalog-page.component';
import {
  buildCatalogSettings,
  emptyCatalogRow,
  emptyCatalogSettingsForm,
  LoadweaverFleetCatalogSettingsDialogComponent,
} from './fleet-catalog-settings-dialog.component';

const A = '6f1c1b0e-0000-4000-8000-00000000000a';
const B = '6f1c1b0e-0000-4000-8000-00000000000b';
const PEM = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----\n';

function pkg(overrides: Partial<FleetCatalogPackage> = {}): FleetCatalogPackage {
  return {
    id: 'p1',
    app: 'wiki',
    version: '1.2.0',
    channel: 'stable',
    title: 'Wiki',
    summary: 'A small wiki.',
    manifestPublisher: 'acme',
    license: 'MIT',
    digest: `sha256:${'a'.repeat(64)}`,
    size: 2048,
    status: 'draft',
    findings: [{ rule: 'unpinned-image', severity: 'warning', message: 'pin it' }],
    uploadedBy: 'fleet:admin',
    createdAt: '2026-10-31T10:00:00.000Z',
    publishedAt: null,
    takenDown: false,
    ...overrides,
  };
}

const info: FleetCatalogInfo = {
  name: 'fleet',
  title: 'Fleet catalog',
  publisher: 'fleet',
  trust: 'verified',
  url: 'https://fleet.example.com',
  publicKey: PEM,
  keyId: 'b'.repeat(64),
  keyType: 'ecdsa-p256',
  index: null,
  paths: { key: '', index: '', indexSignature: '', package: '', packageSignature: '' },
};

function cluster(id: string, name: string, overrides: Partial<FleetCluster> = {}): FleetCluster {
  return {
    id,
    name,
    description: null,
    endpoint: `https://${name}.example.com`,
    hasCustomCa: false,
    credentialHint: 'wxyz',
    reference: null,
    state: 'active',
    readOnlyUntil: null,
    readOnlyReason: null,
    health: { state: 'healthy', checkedAt: null, latencyMs: 3, version: '1.4.0', clusterId: null, error: null },
    access: { clusterRole: 'admin', projects: {}, readOnly: false },
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

function serviceStub(packages: FleetCatalogPackage[] = [pkg()]) {
  return {
    info: jest.fn(() => of(info)),
    packages: jest.fn(() => of(packages)),
    takedowns: jest.fn(() =>
      of([
        { id: 't1', app: 'old', versions: 'all', reason: 'CVE', createdBy: null, createdAt: '2026-10-30T00:00:00Z' },
      ]),
    ),
    upload: jest.fn(() => of(pkg({ id: 'p2', version: '1.3.0' }))),
    publish: jest.fn(() => of(pkg({ status: 'published' }))),
    unpublish: jest.fn(() => of(pkg({ status: 'unpublished' }))),
    remove: jest.fn(() => of(undefined)),
    takedown: jest.fn(() => of({ id: 't2' })),
    liftTakedown: jest.fn(() => of(undefined)),
    applySettings: jest.fn(() => of([{ id: 'op1' }])),
    consoleFleetUrl: jest.fn(() => 'https://console-fleet.example.com'),
  };
}

describe('fleet catalog helpers', () => {
  it('derives the state, short digests and upload error details', () => {
    expect(fleetCatalogPackageState(pkg())).toBe('draft');
    expect(fleetCatalogPackageState(pkg({ status: 'published', takenDown: true }))).toBe('taken-down');
    expect(shortDigest(`sha256:${'c'.repeat(64)}`)).toBe('c'.repeat(12));

    const details = uploadErrorDetails(
      new HttpErrorResponse({
        status: 400,
        error: {
          message: 'the package is invalid',
          findings: [
            { rule: 'privileged', severity: 'error', message: 'privileged' },
            { rule: 'x', severity: 'info', message: 'fine' },
          ],
        },
      }),
    );

    expect(details.message).toContain('the package is invalid');
    expect(details.findings.map((f) => f.rule)).toEqual(['privileged']);
  });

  it('builds the catalog settings request', () => {
    expect(buildCatalogSettings(emptyCatalogSettingsForm(), null)).toEqual({ error: expect.any(String) });

    const form = { ...emptyCatalogSettingsForm(), clusterIds: [A], official: 'enable' as const, apply: true };

    expect(buildCatalogSettings(form, 'https://fleet.example.com')).toEqual({
      request: {
        clusterIds: [A],
        includeFleetCatalog: true,
        fleetCatalogEnabled: true,
        fleetUrl: 'https://fleet.example.com',
        enable: ['official'],
        apply: true,
      },
    });
    expect(
      buildCatalogSettings(
        {
          ...form,
          changeTrust: true,
          allowedTrust: ['community', 'official'],
          includeFleetCatalog: false,
          official: 'keep',
        },
        null,
      ),
    ).toEqual({
      request: { clusterIds: [A], includeFleetCatalog: false, allowedTrust: ['official', 'community'], apply: true },
    });
    expect('error' in buildCatalogSettings({ ...form, changeTrust: true, allowedTrust: [] }, null)).toBe(true);
    expect('error' in buildCatalogSettings({ ...form, catalogs: [emptyCatalogRow()] }, null)).toBe(true);
    expect(
      buildCatalogSettings(
        {
          ...form,
          official: 'keep',
          includeFleetCatalog: false,
          catalogs: [
            { ...emptyCatalogRow(), name: 'priv', url: 'https://git.example.com/apps', ref: 'main', publicKey: PEM },
          ],
        },
        null,
      ),
    ).toEqual({
      request: {
        clusterIds: [A],
        includeFleetCatalog: false,
        catalogs: [
          {
            name: 'priv',
            type: 'git',
            url: 'https://git.example.com/apps',
            ref: 'main',
            publicKeys: [PEM.trim()],
            enabled: true,
          },
        ],
        apply: true,
      },
    });
    expect('error' in buildCatalogSettings({ ...form, official: 'keep', includeFleetCatalog: false }, null)).toBe(true);
  });
});

describe('fleet catalog page', () => {
  it('lists packages with publish / takedown / delete actions, uploads and takes down', async () => {
    const service = serviceStub();

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetCatalogPageComponent],
      providers: [{ provide: FleetCatalogService, useValue: service }],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetCatalogPageComponent);
    const component = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    fixture.detectChanges();
    expect(service.packages).toHaveBeenCalled();
    expect(component.catalogUrl()).toBe('https://fleet.example.com');
    expect(el.querySelector('[data-testid="fleet-catalog-info"]')?.textContent).toContain('https://fleet.example.com');
    expect(el.querySelector('[data-testid="fleet-catalog-takedowns"]')).not.toBeNull();
    // Head toolbar actions are icon-only.
    expect(el.querySelector('[data-testid="fleet-catalog-upload"]')).not.toBeNull();

    const draft = component.packages()[0];

    expect(component.rowMenu(draft).map((i) => i.id)).toEqual(['publish', 'takedown', 'delete', 'copy-digest']);
    expect(component.rowMenu(pkg({ status: 'published' })).map((i) => i.id)).toEqual([
      'unpublish',
      'takedown',
      'copy-digest',
    ]);

    component.onRowAction(draft, 'publish');
    await fixture.whenStable();
    expect(service.publish).toHaveBeenCalledWith('wiki', '1.2.0');

    component.toggle(draft);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="fleet-catalog-detail"]')?.textContent).toContain('pin it');

    // Upload: a file is required; the upload errors show the lint findings.
    component.openUpload();
    await component.submitUpload();
    expect(component.uploadError()?.message).toBeTruthy();
    component.onFiles({ item: () => new File(['x'], 'wiki.tar.gz') } as unknown as FileList);
    component.uploadPublish.set(true);
    await component.submitUpload();
    expect(service.upload).toHaveBeenCalledWith(expect.any(File), { channel: undefined, publish: true });
    expect(component.uploadOpen()).toBe(false);
    expect(component.expanded()).toBe('p2');

    service.upload.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'invalid', findings: [{ rule: 'privileged', severity: 'error', message: 'no' }] },
          }),
      ) as never,
    );
    component.openUpload();
    component.onFiles({ item: () => new File(['x'], 'bad.tar.gz') } as unknown as FileList);
    await component.submitUpload();
    expect(component.uploadError()?.findings).toHaveLength(1);

    // Takedown of one version needs a reason.
    component.openTakedown(draft);
    await component.submitTakedown();
    expect(component.takedownError()).toBeTruthy();
    component.takedownReason.set('Security issue');
    await component.submitTakedown();
    expect(service.takedown).toHaveBeenCalledWith('wiki', { versions: ['1.2.0'], reason: 'Security issue' });

    component.onRowAction(draft, 'delete');
    component.confirmDelete();
    await fixture.whenStable();
    expect(service.remove).toHaveBeenCalledWith('wiki', '1.2.0');

    component.onTakedownAction(component.takedowns()[0], 'lift');
    await component.confirmLift();
    expect(service.liftTakedown).toHaveBeenCalledWith('t1');
    fixture.destroy();
  });
});

describe('fleet catalog settings dialog', () => {
  it('picks clusters and starts the operation', async () => {
    const service = serviceStub();

    await TestBed.configureTestingModule({
      imports: [LoadweaverFleetCatalogSettingsDialogComponent],
      providers: [{ provide: FleetCatalogService, useValue: service }],
    }).compileComponents();

    const fixture = TestBed.createComponent(LoadweaverFleetCatalogSettingsDialogComponent);
    const component = fixture.componentInstance;
    const started = jest.fn();

    fixture.componentRef.setInput('clusters', [cluster(A, 'eu'), cluster(B, 'us', { state: 'teardown' })]);
    component.started.subscribe(started);
    component.open.set(true);
    fixture.detectChanges();

    expect(component.targets().map((c) => c.id)).toEqual([A]);
    await component.submit();
    expect(component.error()).toBeTruthy();
    expect(service.applySettings).not.toHaveBeenCalled();

    component.toggleAll(true);
    expect(component.allSelected()).toBe(true);
    component.patch({ changeTrust: true });
    component.toggleTrust('community', true);
    await component.submit();
    expect(service.applySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterIds: [A],
        includeFleetCatalog: true,
        fleetUrl: 'https://console-fleet.example.com',
        allowedTrust: ['official', 'verified', 'community'],
      }),
    );
    expect(started).toHaveBeenCalledWith([{ id: 'op1' }]);
    expect(component.open()).toBe(false);
    fixture.destroy();
  });
});
