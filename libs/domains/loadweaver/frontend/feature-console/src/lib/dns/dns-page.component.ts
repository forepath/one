import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDnsFacade,
  type DnsFailoverState,
  type DnsProviderResource,
  type DnsRecordResource,
  type DnssecKey,
  type DnssecZone,
  type DnsZoneRow,
  type DnsZoneStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { filterBySearch } from '../list-search';
import { LoadweaverCreateKindButtonComponent } from '../nav/create-kind-button.component';
import { CREATE_HINT } from '../nav/create-kinds';
import { interval } from 'rxjs';

import { mayOperateNodes } from '../nodes/node-format';
import { resourceKey, resourceLink } from '../resources/resource-format';
import {
  dnssecKeyStateLabel,
  dnssecModeLabel,
  dnssecModeTone,
  recordFqdn,
  recordSyncState,
  SYNC_TONE,
  syncLabel,
  zoneSyncLabel,
  zoneSyncState,
  type RecordSyncState,
} from './dns-format';
import { dlOpenItem } from '../section/data-list';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';
import { injectSectionScope, sectionQuery } from '../section/section-scope';

const REFRESH_MS = 60_000;

/** The four DNS pages (3.38: Delivery › DNS sub-nav entries Records | Zones | DNSSEC | Failover), route data `dnsView`. */
export type DnsView = 'records' | 'zones' | 'dnssec' | 'failover';

export interface DnsRecordRow {
  record: DnsRecordResource;
  fqdn: string;
  sync: RecordSyncState;
}

/** One provider of a zone (nested table in the zone's row detail). */
export interface DnsZoneProviderRow extends DnsZoneStatus {
  primary: boolean;
  type: string | null;
}

/** A zone row with its provider rows (precomputed so the nested table keeps its rows between checks). */
export interface DnsZoneTableRow extends DnsZoneRow {
  providers: DnsZoneProviderRow[];
  lastSync: string | null;
}

/** A failover group's endpoint (nested table). */
export interface DnsEndpointRow {
  name: string;
  healthy: boolean;
  since: string;
}

/** The DNS object page of a declared resource as a URL (rowLink). */
function objectUrl(kind: string, name: string, project: string | null): string {
  return resourceLink({ kind, name, project })
    .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
    .join('/');
}

/**
 * DNS (3.15, 3.28): declared records with their sync state and ownership conflicts (projects see their own records),
 * and for cluster roles the zones at their primary and secondary providers, DNSSEC keys and DS state, and DNS
 * failovers with the manual fail-back. 3.38: one page per view (route data `dnsView`, sub-nav entries under
 * Delivery › DNS; `/delivery/dns` = records). Embedded in a site's Network tab (`LW_SECTION_SCOPE`, `q=<site>`) it is
 * the site's records list (scoped client-side, see `site`), no header, no URL writes.
 */
@Component({
  selector: 'loadweaver-dns-page',
  imports: [
    LoadweaverCreateKindButtonComponent,
    LoadweaverSavedViewsComponent,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    CommonModule,
    RouterModule,
  ],
  templateUrl: './dns-page.component.html',
  standalone: true,
})
export class LoadweaverDnsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleDnsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly scope = injectSectionScope();
  /** The view of this page (embedded: always the records). */
  readonly view: DnsView = this.scope ? 'records' : ((this.route.snapshot.data['dnsView'] as DnsView) ?? 'records');

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly zoneRows = toSignal(this.facade.zoneRows$, { initialValue: [] as DnsZoneRow[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly errors = toSignal(this.facade.errors$, { initialValue: [] as string[] });
  readonly confirming = toSignal(this.facade.confirming$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly infrastructure = toSignal(this.access.seesInfrastructure$, { initialValue: false });
  private readonly settled = toSignal(this.access.settled$, { initialValue: false });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  /** Tab of the zones page (decision 4: Managed zones | Providers, one table at a time). */
  readonly zonesTab = signal<'zones' | 'providers'>('zones');
  /** The row whose detail is open (zones: providers, DNSSEC: keys, failover: endpoints). */
  readonly expanded = signal<string | null>(null);
  readonly failbackFor = signal<DnsFailoverState | null>(null);

  readonly mayOperate = computed(() => mayOperateNodes(this.me()?.clusterRole));
  /** Zone resource name → domain (`example` → `example.com`). */
  private readonly domains = computed(
    () => new Map((this.overview()?.zoneResources ?? []).map((z) => [z.metadata.name, z.spec.zone])),
  );
  readonly records = computed<DnsRecordRow[]>(() => {
    const rows = new Map(this.zoneRows().map((r) => [r.zone, r]));
    const domains = this.domains();

    return (this.overview()?.records ?? [])
      .map((record) => {
        const domain = domains.get(record.spec.zone) ?? record.spec.zone;

        return {
          record,
          fqdn: recordFqdn(record.spec.name, domain),
          sync: recordSyncState(record, this.infrastructure() ? (rows.get(record.spec.zone) ?? null) : null, domain),
        };
      })
      .sort((a, b) => a.fqdn.localeCompare(b.fqdn) || a.record.spec.type.localeCompare(b.record.spec.type));
  });
  /** The search of this view (embedded: preset from the scope's `q`). */
  readonly search = signal(sectionQuery(this.route, this.scope).get('q') ?? '');
  /**
   * Embedded in a site's Network tab: the site the records are scoped to (client-side — the API has no site filter:
   * records whose name or values mention the site). Not shown in the search field.
   */
  readonly site = sectionQuery(this.route, this.scope).get('site') ?? '';
  /** The records of this view: all, or the site's. */
  readonly scopedRecords = computed(() => {
    const site = this.site.toLowerCase();

    if (!site) return this.records();

    return this.records().filter((row) =>
      [row.fqdn, row.record.metadata.name, ...row.record.spec.values].some((v) => v.toLowerCase().includes(site)),
    );
  });
  /** "Views ▾" (3.37): saved searches of this view, per user (`dns` = records, as before the split). */
  readonly views = savedViewBinding({ search: this.search });
  readonly viewsScope = this.view === 'records' ? 'dns' : `dns-${this.view}`;
  readonly zoneTable = computed<DnsZoneTableRow[]>(() => {
    const types = this.providerTypes();

    return this.zoneRows().map((z) => ({
      ...z,
      providers: z.statuses.map((s) => ({
        ...s,
        primary: s.provider === z.primary,
        type: types.get(s.provider) ?? null,
      })),
      lastSync:
        z.statuses
          .map((s) => s.syncedAt)
          .filter((at): at is string => !!at)
          .sort()
          .at(-1) ?? null,
    }));
  });
  readonly filteredZones = computed(() =>
    filterBySearch(this.zoneTable(), this.search(), (z) => [
      z.zone,
      this.domainOf(z.zone),
      z.primary,
      z.statuses.map((s) => s.provider),
    ]),
  );
  readonly filteredDnssec = computed(() =>
    filterBySearch(this.overview()?.dnssec ?? [], this.search(), (d) => [
      d.zone,
      d.name,
      dnssecModeLabel(d.mode),
      d.registrar,
      d.keys.map((k) => String(k.keyTag)),
    ]),
  );
  readonly filteredProviders = computed(() =>
    filterBySearch(this.overview()?.providers ?? [], this.search(), (p) => [
      p.metadata.name,
      p.spec.type,
      p.spec.nodeGroup,
    ]),
  );
  readonly filteredFailovers = computed(() =>
    filterBySearch(this.overview()?.failovers ?? [], this.search(), (f) => [f.name, f.state.active]),
  );
  readonly filteredRecords = computed(() =>
    filterBySearch(this.scopedRecords(), this.search(), (row) => [
      row.fqdn,
      row.record.spec.type,
      row.record.spec.values,
      row.record.metadata.name,
      row.record.metadata.project,
      this.syncLabel(row.sync),
    ]),
  );
  readonly providerTypes = computed(
    () => new Map((this.overview()?.providers ?? []).map((p) => [p.metadata.name, p.spec.type])),
  );

  readonly noSiteRecordsTitle = $localize`:@@lwConsoleDns-noSiteRecords:No DNS records for this site`;
  readonly noSiteRecordsHint = $localize`:@@lwConsoleDns-noSiteRecordsHint:Records whose name or values mention the site show up here.`;
  readonly syncTone = SYNC_TONE;
  readonly syncLabel = syncLabel;
  readonly domainOf = (zone: string) => this.domains().get(zone) ?? null;
  /** Endpoints per failover group (precomputed for the nested tables). */
  readonly endpointRows = computed(
    () =>
      new Map(
        (this.overview()?.failovers ?? []).map((f) => [
          f.name,
          Object.entries(f.state.endpoints).map(([name, health]) => ({
            name,
            healthy: health.healthy,
            since: health.since,
          })),
        ]),
      ),
  );
  readonly endpoints = (failover: DnsFailoverState): DnsEndpointRow[] => this.endpointRows().get(failover.name) ?? [];
  readonly dnssecModeLabel = dnssecModeLabel;
  readonly expectedDs = (d: DnssecZone) => d.expectedDs;

  readonly titles: Record<DnsView, string> = {
    records: $localize`:@@lwConsoleDns-recordsTitle:DNS records`,
    zones: $localize`:@@lwConsoleDns-zonesTitle:DNS zones`,
    dnssec: $localize`:@@lwConsoleDns-dnssecTitle:DNSSEC`,
    failover: $localize`:@@lwConsoleDns-failoverTitle:DNS failover`,
  };
  readonly searchLabels: Record<DnsView, string> = {
    records: $localize`:@@lwConsoleDns-search:Search records`,
    zones: $localize`:@@lwConsoleDns-searchZones:Search zones`,
    dnssec: $localize`:@@lwConsoleDns-searchDnssec:Search DNSSEC keys`,
    failover: $localize`:@@lwConsoleDns-searchFailover:Search failover groups`,
  };
  readonly title = this.titles[this.view];
  readonly searchLabel = this.searchLabels[this.view];
  readonly refreshLabel = $localize`:@@lwConsoleDns-refresh:Refresh`;
  readonly createHint = CREATE_HINT;
  readonly zonesLane = $localize`:@@lwConsoleDns-managedZones:Managed zones`;
  readonly loadingLabel = $localize`:@@lwConsoleDns-loading:Loading DNS`;
  readonly clusterOnlyTitle = $localize`:@@lwConsoleDns-clusterOnly:Only cluster roles see zones, DNSSEC and failovers`;
  readonly providersTitle = $localize`:@@lwConsoleDns-providers:Providers`;
  readonly failbackTitle = $localize`:@@lwConsoleDns-failbackTitle:Fail back to the primary?`;
  readonly failbackMessage = $localize`:@@lwConsoleDns-failbackMessage:The primary endpoint is healthy again. DNS answers switch back to it.`;
  readonly failbackConfirm = $localize`:@@lwConsoleDns-failbackConfirm:Fail back`;
  readonly cancelLabel = $localize`:@@lwConsoleDns-cancel:Cancel`;
  readonly keysTitle = $localize`:@@lwConsoleDns-keys:Keys`;
  readonly endpointsTitle = $localize`:@@lwConsoleDns-endpoints:Endpoints`;
  readonly zoneProvidersTitle = $localize`:@@lwConsoleDns-zoneProviders:Provider sync`;
  readonly dnssecBadgeLabel = 'DNSSEC';

  /** 3.38 D1: State (sync) · Name (link) · type · values · TTL · priority · project. */
  readonly recordColumns: FpcTableColumn<DnsRecordRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (row) => ({ label: syncLabel(row.sync), tone: SYNC_TONE[row.sync] }),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleDns-colName:Name`,
      value: (row) => row.fqdn,
      required: true,
      priority: 1,
      mono: true,
    },
    { id: 'type', label: $localize`:@@lwConsoleDns-colType:Type`, value: (row) => row.record.spec.type, priority: 1 },
    {
      id: 'values',
      label: $localize`:@@lwConsoleDns-colValues:Values`,
      value: (row) => row.record.spec.values.join(', '),
      mono: true,
      priority: 2,
    },
    {
      id: 'ttl',
      label: 'TTL',
      value: (row) => row.record.spec.ttl ?? null,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    {
      id: 'priority',
      label: $localize`:@@lwConsoleDns-priority:Priority`,
      value: (row) => row.record.spec.priority ?? null,
      align: 'end',
      width: '6rem',
      priority: 3,
      hidden: true,
    },
    {
      id: 'project',
      label: $localize`:@@lwConsoleDns-colProject:Project`,
      value: (row) => row.record.metadata.project ?? '',
      priority: 2,
    },
  ];

  /** Zones: State · Domain (link) · primary · DNSSEC · foreign names · last sync; providers in the row detail. */
  readonly zoneColumns: FpcTableColumn<DnsZoneTableRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (z) => {
        const state = zoneSyncState(z);

        return { label: zoneSyncLabel(state), tone: SYNC_TONE[state] };
      },
    },
    {
      id: 'domain',
      label: $localize`:@@lwConsoleDns-colDomain:Domain`,
      value: (z) => this.domainOf(z.zone) ?? z.zone,
      required: true,
      priority: 1,
    },
    {
      id: 'zone',
      label: $localize`:@@lwConsoleDns-colZone:Zone resource`,
      value: (z) => z.zone,
      mono: true,
      priority: 3,
    },
    {
      id: 'primary',
      label: $localize`:@@lwConsoleDns-primary:Primary`,
      value: (z) => z.primary ?? '',
      priority: 1,
    },
    { id: 'dnssec', label: 'DNSSEC', value: (z) => (z.dnssec ? 1 : 0), width: '6rem', priority: 2 },
    {
      id: 'conflicts',
      label: $localize`:@@lwConsoleDns-colConflicts:Foreign names`,
      value: (z) => z.conflicts,
      align: 'end',
      width: '8rem',
      priority: 2,
    },
    { id: 'lastSync', label: $localize`:@@lwConsoleDns-lastSync:Last sync`, value: (z) => z.lastSync, priority: 2 },
  ];

  /** A zone's providers (nested): State · Provider · role · type · last sync · changes · message. */
  readonly zoneProviderColumns: FpcTableColumn<DnsZoneProviderRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (s) =>
        s.error
          ? { label: $localize`:@@lwConsoleDns-error:Error`, tone: 'danger' }
          : s.syncedAt
            ? { label: syncLabel('synced'), tone: 'success' }
            : { label: syncLabel('pending'), tone: 'info' },
    },
    {
      id: 'provider',
      label: $localize`:@@lwConsoleDns-colProvider:Provider`,
      value: (s) => s.provider,
      required: true,
      priority: 1,
    },
    {
      id: 'role',
      label: $localize`:@@lwConsoleDns-colRole:Role`,
      value: (s) => (s.primary ? this.primaryLabel : this.secondaryLabel),
      priority: 1,
    },
    { id: 'type', label: $localize`:@@lwConsoleDns-colType:Type`, value: (s) => s.type ?? '', priority: 3 },
    { id: 'syncedAt', label: $localize`:@@lwConsoleDns-lastSync:Last sync`, value: (s) => s.syncedAt, priority: 2 },
    {
      id: 'changes',
      label: $localize`:@@lwConsoleDns-colChanges:Changes`,
      value: (s) => s.changes,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    { id: 'message', label: $localize`:@@lwConsoleDns-colMessage:Message`, priority: 2 },
  ];

  /** Providers tab: Name (link) · type · node group. */
  readonly providerColumns: FpcTableColumn<DnsProviderResource>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleDns-colName:Name`,
      value: (p) => p.metadata.name,
      required: true,
      priority: 1,
    },
    { id: 'type', label: $localize`:@@lwConsoleDns-colType:Type`, value: (p) => p.spec.type, priority: 1 },
    {
      id: 'nodeGroup',
      label: $localize`:@@lwConsoleDns-nodeGroup:Node group`,
      value: (p) => p.spec.nodeGroup ?? '',
      priority: 2,
    },
  ];

  /** DNSSEC: State (mode) · Zone · registrar · DS at parent · next rollover; keys + expected DS in the row detail. */
  readonly dnssecColumns: FpcTableColumn<DnssecZone>[] = [
    {
      id: 'mode',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (d) => ({ label: dnssecModeLabel(d.mode), tone: dnssecModeTone(d.mode) }),
    },
    {
      id: 'zone',
      label: $localize`:@@lwConsoleDns-colZone:Zone resource`,
      value: (d) => d.zone,
      required: true,
      priority: 1,
    },
    {
      id: 'registrar',
      label: $localize`:@@lwConsoleDns-registrar:Registrar`,
      value: (d) => d.registrar ?? '',
      priority: 2,
    },
    {
      id: 'ds',
      label: $localize`:@@lwConsoleDns-colDs:DS at parent`,
      value: (d) => (this.dsComplete(d) ? 1 : 0),
      width: '8rem',
      priority: 1,
    },
    {
      id: 'rollover',
      label: $localize`:@@lwConsoleDns-nextRollover:Next rollover`,
      value: (d) => d.nextRolloverAt,
      priority: 2,
    },
  ];

  /** DNSSEC keys (nested): State · Key tag · DS at parent · checked · created. */
  readonly keyColumns: FpcTableColumn<DnssecKey>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (k) => ({
        label: dnssecKeyStateLabel(k.state),
        tone: k.state === 'active' ? 'success' : 'neutral',
      }),
    },
    {
      id: 'keyTag',
      label: $localize`:@@lwConsoleDns-colKeyTag:Key tag`,
      value: (k) => k.keyTag,
      required: true,
      priority: 1,
      mono: true,
    },
    {
      id: 'ds',
      label: $localize`:@@lwConsoleDns-colDs:DS at parent`,
      value: (k) => (k.dsAtParent ? 1 : 0),
      priority: 1,
    },
    { id: 'checked', label: $localize`:@@lwConsoleDns-checked:checked`, value: (k) => k.dsCheckedAt, priority: 2 },
    { id: 'created', label: $localize`:@@lwConsoleDns-colCreated:Created`, value: (k) => k.createdAt, priority: 3 },
  ];

  /** Failover: State · Group · answering · propagation · switched; endpoints in the row detail; ⋮ Confirm fail-back. */
  readonly failoverColumns: FpcTableColumn<DnsFailoverState>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (f) =>
        f.state.failbackPending
          ? {
              label: $localize`:@@lwConsoleDns-failbackPending:Fail-back pending`,
              tone: 'info',
              icon: 'arrow-return-left',
            }
          : this.endpoints(f).some((e) => !e.healthy)
            ? { label: $localize`:@@lwConsoleDns-endpointDown:Endpoint down`, tone: 'danger' }
            : { label: $localize`:@@lwConsoleDns-allHealthy:All endpoints healthy`, tone: 'success' },
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleDns-colGroup:Failover group`,
      value: (f) => f.name,
      required: true,
      priority: 1,
    },
    {
      id: 'answering',
      label: $localize`:@@lwConsoleDns-answering:Answering`,
      value: (f) => f.state.active.join(', '),
      mono: true,
      priority: 1,
    },
    { id: 'propagation', label: $localize`:@@lwConsoleDns-colPropagation:Propagation`, priority: 2 },
    { id: 'switched', label: $localize`:@@lwConsoleDns-switched:Switched`, value: (f) => f.switchedAt, priority: 2 },
  ];

  /** Endpoints (nested): State · Endpoint · since. */
  readonly endpointColumns: FpcTableColumn<DnsEndpointRow>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleDns-colState:State`,
      type: 'state',
      state: (e) =>
        e.healthy
          ? { label: $localize`:@@lwConsoleDns-healthy:Healthy`, tone: 'success' }
          : { label: $localize`:@@lwConsoleDns-unhealthy:Unhealthy`, tone: 'danger' },
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleDns-colEndpoint:Endpoint`,
      value: (e) => e.name,
      required: true,
      priority: 1,
      mono: true,
    },
    { id: 'since', label: $localize`:@@lwConsoleDns-since:since`, value: (e) => e.since, priority: 1 },
  ];

  readonly primaryLabel = $localize`:@@lwConsoleDns-primary:Primary`;
  readonly secondaryLabel = $localize`:@@lwConsoleDns-secondary:Secondary`;
  readonly dsAtParentLabel = $localize`:@@lwConsoleDns-dsAtParent:DS at parent`;
  readonly dsMissingLabel = $localize`:@@lwConsoleDns-dsMissing:DS not at parent`;
  readonly propagatedLabel = $localize`:@@lwConsoleDns-propagated:Propagated`;
  readonly laggingLabel = $localize`:@@lwConsoleDns-lagging:Lagging`;
  readonly failbackLabel = $localize`:@@lwConsoleDns-failback:Confirm fail-back`;

  readonly recordId = (row: DnsRecordRow) => `${row.record.metadata.project ?? ''}/${row.record.metadata.name}`;
  readonly zoneId = (z: DnsZoneTableRow) => z.zone;
  readonly providerRowId = (s: DnsZoneProviderRow) => s.provider;
  readonly providerId = (p: DnsProviderResource) => p.metadata.name;
  readonly dnssecId = (d: DnssecZone) => d.name;
  readonly keyId = (k: DnssecKey) => String(k.keyTag);
  readonly failoverId = (f: DnsFailoverState) => f.name;
  readonly endpointId = (e: DnsEndpointRow) => e.name;
  readonly recordLink = (row: DnsRecordRow) => {
    const key = resourceKey(row.record);

    return objectUrl(key.kind, key.name, key.project);
  };
  /** Zones with a declaration open their object page; sync-only zones have none. */
  readonly zoneLink = (z: DnsZoneTableRow) => (this.domains().has(z.zone) ? objectUrl('DnsZone', z.zone, null) : null);
  readonly providerLink = (p: DnsProviderResource) => objectUrl('DnsProvider', p.metadata.name, null);
  /** Every active key's DS is published at the parent. */
  readonly dsComplete = (d: DnssecZone) => d.keys.filter((k) => k.state === 'active').every((k) => k.dsAtParent);
  readonly recordMenu = (): FpcMenuItem[] => [dlOpenItem()];
  readonly failoverMenu = (f: DnsFailoverState): FpcMenuItem[] =>
    f.state.failbackPending && this.mayOperate()
      ? [{ id: 'failback', label: this.failbackLabel, icon: 'arrow-return-left' }]
      : [];

  constructor() {
    // Cluster-only parts are read once the caller's role is known.
    effect(() => {
      if (this.settled()) {
        const infrastructure = this.infrastructure();

        untracked(() => this.facade.load(infrastructure));
      }
    });
  }

  ngOnInit(): void {
    this.access.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.infrastructure(), true));
  }

  refresh(): void {
    this.facade.load(this.infrastructure());
  }

  openRecord(row: DnsRecordRow): void {
    void this.router.navigate(resourceLink(resourceKey(row.record)));
  }

  /** Row click / Enter toggles the row detail. */
  toggle(id: string): void {
    this.expanded.update((open) => (open === id ? null : id));
  }

  onFailoverAction(failover: DnsFailoverState, action: string): void {
    if (action === 'failback') this.failbackFor.set(failover);
  }

  onFailbackOpenChange(open: boolean): void {
    if (!open) this.failbackFor.set(null);
  }

  confirmFailback(): void {
    const failover = this.failbackFor();

    if (failover) this.facade.confirmFailback(failover.name);

    this.failbackFor.set(null);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }
}
