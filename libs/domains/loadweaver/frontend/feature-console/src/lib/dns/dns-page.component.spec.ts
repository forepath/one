import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleDnsFacade,
  type DnsOverview,
  type DnsZoneRow,
} from '@forepath/loadweaver/frontend/data-access-console';

import { accessStub, facadeStub } from '../testing';
import { LoadweaverDnsPageComponent } from './dns-page.component';

const overview: DnsOverview = {
  records: [
    {
      apiVersion: 'loadweaver.com/v1',
      kind: 'DnsRecord',
      metadata: { name: 'www', project: 'shop' },
      spec: { zone: 'example', name: 'www', type: 'A', values: ['203.0.113.10'], ttl: 300 },
    },
    {
      apiVersion: 'loadweaver.com/v1',
      kind: 'DnsRecord',
      metadata: { name: 'mail' },
      spec: { zone: 'example', name: 'mail', type: 'MX', values: ['mx.example.net.'], priority: 10 },
    },
  ],
  zones: [
    {
      zone: 'example',
      provider: 'bind',
      syncedAt: '2026-10-01T10:00:00.000Z',
      error: null,
      conflicts: ['mail.example.com'],
      changes: 2,
      drift: null,
    },
    {
      zone: 'example',
      provider: 'cf',
      syncedAt: null,
      error: 'invalid token',
      conflicts: [],
      changes: 0,
      drift: '3 records behind',
    },
  ],
  dnssec: [
    {
      zone: 'example.com',
      name: 'example',
      mode: 'signed',
      registrar: null,
      expectedDs: ['example.com. IN DS 12345 13 2 ABCD'],
      keys: [
        {
          keyTag: 12345,
          state: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          retiredAt: null,
          dsAtParent: false,
          dsCheckedAt: null,
          ds: 'x',
        },
      ],
      nextRolloverAt: '2027-01-01T00:00:00.000Z',
    },
  ],
  failovers: [
    {
      name: 'shop',
      state: {
        endpoints: { primary: { healthy: true, streak: 3, since: '2026-10-01T10:00:00.000Z' } },
        active: ['backup'],
        failbackPending: true,
      },
      switchedAt: '2026-10-01T09:00:00.000Z',
      propagation: { done: true, lagging: [], checkedAt: '2026-10-01T09:01:00.000Z' },
      failbackConfirmed: false,
    },
  ],
  zoneResources: [
    {
      apiVersion: 'loadweaver.com/v1',
      kind: 'DnsZone',
      metadata: { name: 'example' },
      spec: { zone: 'example.com', provider: 'bind', secondaries: ['cf'], dnssec: true },
    },
  ],
  providers: [
    { apiVersion: 'loadweaver.com/v1', kind: 'DnsProvider', metadata: { name: 'bind' }, spec: { type: 'bind9' } },
  ],
};
const zoneRows: DnsZoneRow[] = [
  {
    zone: 'example',
    primary: 'bind',
    dnssec: true,
    statuses: overview.zones ?? [],
    conflicts: 1,
    failing: true,
  },
];

describe('LoadweaverDnsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverDnsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(me: AccessMe, data: DnsOverview = overview) {
    facade = facadeStub(
      {
        overview$: data,
        zoneRows$: me.clusterRole ? zoneRows : [],
        loading$: false,
        errors$: [],
        confirming$: null,
        actionError$: null,
      },
      ['load', 'confirmFailback', 'clearActionError'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverDnsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ConsoleDnsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverDnsPageComponent);
    render();
  }

  /** Tabs show their content after the group's render pass (the page's refresh timer keeps the zone busy). */
  function render(): void {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('loads everything for cluster roles and shows records with their sync state', async () => {
    await setup({ userId: 'u', clusterRole: 'infra-operator', projects: {} });

    expect(facade['load']).toHaveBeenCalledWith(true);

    const component = fixture.componentInstance;

    expect(component.records().map((r) => [r.fqdn, r.sync])).toEqual([
      ['mail.example.com', 'conflict'],
      ['www.example.com', 'failing'],
    ]);
    expect(el().querySelector('[data-testid="dns-records"]')?.textContent).toContain('Owned by someone else');
  });

  it('shows zones, DNSSEC and failovers with the fail-back', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} });

    const component = fixture.componentInstance;

    component.activeTab.set('zones');
    render();
    expect(el().querySelector('[data-testid="dns-zone-example"]')?.textContent).toContain('DNSSEC');
    expect(el().textContent).toContain('invalid token');
    expect(el().textContent).toContain('3 records behind');
    expect(el().querySelector('[data-testid="dns-providers"]')?.textContent).toContain('bind9');

    component.activeTab.set('dnssec');
    render();
    expect(el().querySelector('[data-testid="dns-dnssec"]')?.textContent).toContain('DS not at parent');
    expect(el().querySelector('[data-testid="dns-dnssec"]')?.textContent).toContain('IN DS 12345');

    component.activeTab.set('failover');
    render();
    expect(el().querySelector('[data-testid="dns-failback-shop"]')).not.toBeNull();

    component.failbackFor.set((overview.failovers ?? [])[0]);
    component.confirmFailback();
    expect(facade['confirmFailback']).toHaveBeenCalledWith('shop');
  });

  it('shows project members their records only', async () => {
    await setup(
      { userId: 'u', clusterRole: null, projects: { shop: 'developer' } },
      { ...overview, zones: null, dnssec: null, failovers: null, zoneResources: null, providers: null },
    );

    expect(facade['load']).toHaveBeenCalledWith(false);
    expect(fixture.componentInstance.records().map((r) => [r.fqdn, r.sync])).toEqual([
      ['mail.example', 'unknown'],
      ['www.example', 'unknown'],
    ]);
    expect(el().textContent).not.toContain('DNSSEC');

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.newRecord();
    expect(navigate).toHaveBeenCalledWith(['/resources', 'new'], {
      queryParams: { kind: 'DnsRecord', project: 'shop' },
    });

    fixture.componentInstance.openRecord(fixture.componentInstance.records()[1]);
    expect(navigate).toHaveBeenCalledWith(['/resources', 'DnsRecord', 'www'], { queryParams: { project: 'shop' } });
  });
});
