import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  type AccessMe,
  AppStoreService,
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  ConsoleResourcesFacade,
  type ConsoleResource,
  IntegrationsService,
  NodesService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { of } from 'rxjs';

import { ResourceModalService } from '../objects/resource-modal.service';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverIntegrationsPageComponent } from './integrations-page.component';

const res = (kind: string, name: string, spec: Record<string, unknown>): ConsoleResource =>
  ({ apiVersion: 'loadweaver.com/v1', kind, metadata: { name, project: null }, spec }) as unknown as ConsoleResource;

describe('LoadweaverIntegrationsPageComponent (3.41)', () => {
  let fixture: ComponentFixture<LoadweaverIntegrationsPageComponent>;
  let integrations: { status: jest.Mock; test: jest.Mock };
  let appStore: { catalogs: jest.Mock; refreshCatalogs: jest.Mock };

  async function setup(me: AccessMe) {
    integrations = {
      status: jest.fn(() => of([{ id: 'smtp', label: 'Email (SMTP)', active: true, details: { server: 'mail:587' } }])),
      test: jest.fn(() => of({ ok: false, message: 'zone example.com not found', durationMs: 120 })),
    };
    appStore = {
      catalogs: jest.fn(() =>
        of({ catalogs: [{ name: 'official', type: 'oci', url: 'oci://r/apps', enabled: true }], allowedTrust: [] }),
      ),
      refreshCatalogs: jest.fn(() => of([{ name: 'official', type: 'oci', url: 'oci://r/apps', enabled: true }])),
    };

    await TestBed.configureTestingModule({
      imports: [LoadweaverIntegrationsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        {
          provide: ConsoleResourcesFacade,
          useValue: facadeStub(
            {
              resources$: [
                res('Cluster', 'default', {
                  observability: { siem: [{ name: 'splunk', type: 'webhook', url: 'https://s' }] },
                  appStore: { catalogs: [{ name: 'official', type: 'oci', url: 'oci://r/apps', enabled: true }] },
                }),
                res('DnsProvider', 'cf', { type: 'cloudflare' }),
              ],
            },
            ['load'],
          ),
        },
        { provide: ConsoleGitFacade, useValue: facadeStub({ connections$: [] }, ['load']) },
        { provide: IntegrationsService, useValue: integrations },
        { provide: NodesService, useValue: { siem: jest.fn(() => of([])) } },
        { provide: AppStoreService, useValue: appStore },
        { provide: ConsoleEndpointService, useValue: { fleetMode: false } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverIntegrationsPageComponent);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  const row = (page: LoadweaverIntegrationsPageComponent, id: string) => {
    const found = page.rows().find((r) => r.id === id);

    if (!found) throw new Error(`no row ${id}`);

    return found;
  };

  it('cluster admins edit, test (SIEM too) and see the environment read-only', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    expect(integrations.status).toHaveBeenCalled();
    expect(page.rows().some((r) => r.id === 'env:smtp')).toBe(true);
    expect(page.rowMenu(row(page, 'dns:cf')).map((i) => i.id)).toEqual(['edit', 'test']);
    expect(page.rowMenu(row(page, 'siem:splunk')).map((i) => i.id)).toEqual(['edit', 'test']);
    expect(page.rowMenu(row(page, 'env:smtp'))).toEqual([]);

    const modal = TestBed.inject(ResourceModalService);

    page.onRowAction(row(page, 'siem:splunk'), 'edit');
    expect(modal.request()).toEqual({
      mode: 'edit',
      key: { kind: 'Cluster', name: 'default', project: null },
      step: 'operations',
    });
  });

  it('infra operators edit and test cluster-wide providers, not the Cluster or SIEM, and see no environment', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'infra-operator', projects: {} });

    expect(integrations.status).not.toHaveBeenCalled();
    expect(page.rows().some((r) => r.area === 'environment')).toBe(false);
    expect(page.rowMenu(row(page, 'dns:cf')).map((i) => i.id)).toEqual(['edit', 'test']);
    expect(page.rowMenu(row(page, 'siem:splunk')).map((i) => i.id)).toEqual([]);
    // Webhooks are cluster-admin only (the page isn't theirs).
    expect(page.rows().some((r) => r.id === 'webhooks')).toBe(false);
  });

  it('auditors only look (links stay, no edit / test)', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'auditor', projects: {} });

    expect(page.rowMenu(row(page, 'dns:cf'))).toEqual([]);
    expect(page.rowMenu(row(page, 'posture')).map((i) => i.id)).toEqual(['open']);
  });

  it('shows a failed test as the row state and a notice; Open navigates', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    page.onRowAction(row(page, 'dns:cf'), 'test');
    fixture.detectChanges();

    expect(integrations.test).toHaveBeenCalledWith('DnsProvider', 'cf');
    expect(page.columns[0].state?.(row(page, 'dns:cf'))).toEqual({ label: 'Test failed', tone: 'danger' });
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="integrations-test-result"]')?.textContent,
    ).toContain('zone example.com not found');

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    page.onRowAction(row(page, 'posture'), 'open');
    expect(navigate).toHaveBeenCalledWith('/access/posture');
  });
  it('opens a row with a click: Edit, else Set up, else Open; nothing without a permitted action', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });
    const modal = TestBed.inject(ResourceModalService);

    page.onRowActivate(row(page, 'dns:cf'));
    expect(modal.request()).toEqual({ mode: 'edit', key: { kind: 'DnsProvider', name: 'cf', project: null } });

    page.onRowActivate(row(page, 'backup:none'));
    expect(modal.request()).toEqual({ mode: 'create', kind: 'BackupTarget', project: null });
    expect(integrations.test).not.toHaveBeenCalled();
  });

  it('app store catalog sources: edit on the Cluster step and Refresh catalogs for cluster admins only (P1)', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    expect(appStore.catalogs).toHaveBeenCalled();
    expect(page.rowMenu(row(page, 'appstore:official')).map((i) => i.id)).toEqual(['edit', 'refresh-catalogs', 'open']);

    page.onRowAction(row(page, 'appstore:official'), 'edit');
    expect(TestBed.inject(ResourceModalService).request()).toEqual({
      mode: 'edit',
      key: { kind: 'Cluster', name: 'default', project: null },
      step: 'appStore',
    });

    page.onRowAction(row(page, 'appstore:official'), 'refresh-catalogs');
    expect(appStore.refreshCatalogs).toHaveBeenCalled();
    expect(page.lastTest()?.outcome.ok).toBe(true);
    TestBed.resetTestingModule();

    const operator = await setup({ userId: 'u', clusterRole: 'infra-operator', projects: {} });

    expect(operator.rowMenu(row(operator, 'appstore:official')).map((i) => i.id)).toEqual(['open']);
  });

  it('shows a trusted fleet’s catalog as managed by the fleet, without edit (2026-11-01)', async () => {
    const page = await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    appStore.catalogs.mockReturnValue(
      of({
        catalogs: [
          { name: 'official', type: 'oci', url: 'oci://r/apps', enabled: true },
          {
            name: 'acme-fleet',
            type: 'fleet',
            url: 'https://fleet.acme.example/',
            enabled: true,
            fleetManaged: true,
            fleet: { issuer: 'fleet-1', name: 'Acme fleet' },
          },
        ],
        allowedTrust: ['official', 'verified'],
      }),
    );
    page.reload();
    fixture.detectChanges();

    expect(page.rowMenu(row(page, 'appstore:acme-fleet')).map((i) => i.id)).toEqual(['refresh-catalogs', 'open']);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Managed by fleet Acme fleet');
  });
});
