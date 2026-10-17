import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleDnsFacade,
  type DnsFailoverState,
  type DnsRecordResource,
  type DnsZoneRow,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { mayOperateNodes } from '../nodes/node-format';
import { projectParams, resourceKey, resourceLink } from '../resources/resource-format';
import { recordFqdn, recordSyncState, SYNC_TONE, syncLabel, type RecordSyncState } from './dns-format';

const REFRESH_MS = 60_000;

export interface DnsRecordRow {
  record: DnsRecordResource;
  fqdn: string;
  sync: RecordSyncState;
}

/**
 * DNS (3.15, 3.28): declared records with their sync state and ownership conflicts (projects see their own records),
 * and for cluster roles the zones at their primary and secondary providers, DNSSEC keys and DS state, and DNS
 * failovers with the manual fail-back.
 */
@Component({
  selector: 'loadweaver-dns-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './dns-page.component.html',
  standalone: true,
})
export class LoadweaverDnsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleDnsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly overview = toSignal(this.facade.overview$, { initialValue: null });
  readonly zoneRows = toSignal(this.facade.zoneRows$, { initialValue: [] as DnsZoneRow[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly errors = toSignal(this.facade.errors$, { initialValue: [] as string[] });
  readonly confirming = toSignal(this.facade.confirming$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly infrastructure = toSignal(this.access.seesInfrastructure$, { initialValue: false });
  private readonly settled = toSignal(this.access.settled$, { initialValue: false });
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  readonly activeTab = signal<string | null>('records');
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
  readonly providerTypes = computed(
    () => new Map((this.overview()?.providers ?? []).map((p) => [p.metadata.name, p.spec.type])),
  );

  readonly syncTone = SYNC_TONE;
  readonly syncLabel = syncLabel;
  readonly domainOf = (zone: string) => this.domains().get(zone) ?? null;
  readonly endpoints = (failover: DnsFailoverState) =>
    Object.entries(failover.state.endpoints).map(([name, health]) => ({ name, ...health }));

  readonly title = $localize`:@@lwConsoleDns-title:DNS`;
  readonly refreshLabel = $localize`:@@lwConsoleDns-refresh:Refresh`;
  readonly recordsTab = $localize`:@@lwConsoleDns-recordsTab:Records`;
  readonly zonesTab = $localize`:@@lwConsoleDns-zonesTab:Zones`;
  readonly dnssecTab = $localize`:@@lwConsoleDns-dnssecTab:DNSSEC`;
  readonly failoverTab = $localize`:@@lwConsoleDns-failoverTab:Failover`;
  readonly providersTitle = $localize`:@@lwConsoleDns-providers:Providers`;
  readonly failbackTitle = $localize`:@@lwConsoleDns-failbackTitle:Fail back to the primary?`;
  readonly failbackMessage = $localize`:@@lwConsoleDns-failbackMessage:The primary endpoint is healthy again. DNS answers switch back to it.`;
  readonly failbackConfirm = $localize`:@@lwConsoleDns-failbackConfirm:Fail back`;
  readonly cancelLabel = $localize`:@@lwConsoleDns-cancel:Cancel`;

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
    void this.router.navigate(resourceLink(resourceKey(row.record)), {
      queryParams: projectParams(row.record.metadata.project),
    });
  }

  newRecord(): void {
    // Project members declare records in their (first) project, cluster roles start cluster-level.
    const project = this.infrastructure() ? null : (Object.keys(this.me()?.projects ?? {}).sort()[0] ?? null);

    void this.router.navigate(['/resources', 'new'], { queryParams: { kind: 'DnsRecord', ...projectParams(project) } });
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
