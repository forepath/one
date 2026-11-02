import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleDnsFacade,
  type DnsOverview,
  type DnsZoneRow,
} from '@forepath/loadweaver/frontend/data-access-console';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub } from '../testing';
import { type DnsView, LoadweaverDnsPageComponent } from './dns-page.component';

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

  async function setup(
    me: AccessMe,
    data: DnsOverview = overview,
    view: DnsView = 'records',
    scope: Record<string, string> | null = null,
  ) {
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
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { dnsView: view }, queryParamMap: convertToParamMap({}) } },
        },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
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
    const states = [...el().querySelectorAll('[data-testid="dns-records"] [data-testid="fpc-data-table-state"]')].map(
      (state) => state.getAttribute('aria-label'),
    );

    expect(states).toContain('Owned by someone else');
    expect(el().querySelector('[data-testid="dns-records"] a.fpc-data-table__link')?.getAttribute('href')).toContain(
      '/resources/dnsrecord/',
    );
  });

  it('searches the records in the table head (no counter header)', async () => {
    await setup({ userId: 'u', clusterRole: 'infra-operator', projects: {} });

    const component = fixture.componentInstance;

    expect(el().querySelector('fpc-list-header')).toBeNull();
    component.search.set('mail');
    render();
    expect(component.filteredRecords().map((r) => r.fqdn)).toEqual(['mail.example.com']);
    expect(el().querySelector('fpc-list-header')).toBeNull();

    component.search.set('nothing');
    render();
    expect(el().querySelector('[data-testid="fpc-data-table-no-matches"]')).not.toBeNull();
  });

  it('shows the zones page as tabs: zones table with provider rows in the detail, providers table', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }, overview, 'zones');

    const component = fixture.componentInstance;

    expect(component.title).toBe('DNS zones');
    expect(el().querySelector('[data-testid="dns-zones-tabs"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="dns-zones"] fpc-badge[aria-label="DNSSEC"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="dns-zones"] input')?.getAttribute('placeholder')).toBe('Search zones');

    component.toggle('example');
    render();
    expect(el().querySelector('[data-testid="dns-zone-example"]')).not.toBeNull();
    expect(el().textContent).toContain('invalid token');
    expect(el().textContent).toContain('3 records behind');

    component.zonesTab.set('providers');
    render();
    expect(el().querySelector('[data-testid="dns-providers"]')?.textContent).toContain('bind9');
    expect(el().querySelector('[data-testid="dns-zones"]')).toBeNull();
  });

  it('shows the DNSSEC page with key rows', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }, overview, 'dnssec');

    expect(el().querySelector('[data-testid="dns-dnssec"] fpc-badge[aria-label="DS not at parent"]')).not.toBeNull();

    fixture.componentInstance.toggle((overview.dnssec ?? [])[0].name);
    render();
    expect(el().querySelector('[data-testid="dns-dnssec-keys"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="dns-dnssec"]')?.textContent).toContain('IN DS 12345');
    expect(el().querySelector('[data-testid="dns-dnssec"] input')?.getAttribute('placeholder')).toBe(
      'Search DNSSEC keys',
    );
  });

  it('shows the failover page with the fail-back', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }, overview, 'failover');

    const component = fixture.componentInstance;

    const shop = (overview.failovers ?? [])[0];

    expect(component.failoverMenu(shop).map((item) => item.id)).toEqual(['failback']);
    expect(el().querySelector('[data-testid="dns-failovers"] input')?.getAttribute('placeholder')).toBe(
      'Search failover groups',
    );

    component.onFailoverAction(shop, 'failback');
    expect(component.failbackFor()).toBe(shop);
    component.confirmFailback();
    expect(facade['confirmFailback']).toHaveBeenCalledWith('shop');
  });

  it('embedded in a site tab: the records with the scope search, no header, actions in the strip', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }, overview, 'zones', { q: 'mail' });

    const component = fixture.componentInstance;
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    expect(component.view).toBe('records');
    expect(component.search()).toBe('mail');
    expect(component.filteredRecords().map((r) => r.fqdn)).toEqual(['mail.example.com']);
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="dns-new-record"]')).toBeNull();
    // Table-head "+" of the records table (2026-10-29).
    expect(el().querySelector('[data-testid="dns-records"] [data-testid="create-kind-DnsRecord"]')).not.toBeNull();
    expect(el().querySelector('fpc-list-toolbar [data-testid="dns-refresh"]')).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("embedded in a site's Network tab: scoped to the site internally, the search stays empty", async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }, overview, 'zones', { site: 'mail' });

    const component = fixture.componentInstance;

    expect(component.search()).toBe('');
    expect(component.filteredRecords().map((r) => r.fqdn)).toEqual(['mail.example.com']);
  });

  it('embedded for a site without records: the site empty state, not "No matches"', async () => {
    await setup({ userId: 'u', clusterRole: 'cluster-admin', projects: {} }, overview, 'zones', { site: 'nowhere' });

    expect(el().querySelector('[data-testid="dns-no-site-records"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="fpc-data-table-no-matches"]')).toBeNull();
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

    fixture.componentInstance.openRecord(fixture.componentInstance.records()[1]);
    expect(navigate).toHaveBeenCalledWith(['/resources', 'dnsrecord', 'shop', 'www']);
  });
});
