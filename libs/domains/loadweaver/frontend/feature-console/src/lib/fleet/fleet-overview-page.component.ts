import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import {
  ConsoleFleetFacade,
  fleetAvailabilityOf,
  type FleetCard,
  type FleetInboxItem,
  type FleetSite,
  type HealthState,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcKeyValueListComponent,
  type FpcKeyValueItem,
  type FpcMenuItem,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import {
  fleetCapacityPercent,
  fleetConnectionIcon,
  fleetConnectionLabel,
  fleetConnectionState,
  fleetConnectionTone,
  fleetLinkTarget,
  fleetRoleLabel,
} from './fleet-format';
import { inboxItemTitle } from '../overview/activity-format';
import { filterBySearch } from '../list-search';
import { healthLabel } from '../overview/console-format';
import { severityLabel } from '../alerts/alert-format';
import { DL_OPEN } from '../section/data-list';

import { LoadweaverFleetWorldMapComponent } from './fleet-world-map.component';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** How often the overview refreshes (the fleet caches the clusters' answers for 30 s by default). */
export const FLEET_OVERVIEW_REFRESH_MS = 60_000;

/**
 * Fleet overview (3.24 / 3.25; 3.38 lanes): summary bar, then the lanes Clusters (one row per cluster: connection,
 * health, version / upgrade, nodes, open alerts, pending plans, capacity, Loadweaver Cloud teardown / grace) | Needs
 * attention (the merged inbox) | Sites (world map). A row or an inbox item opens that cluster through the relay.
 */
@Component({
  selector: 'loadweaver-fleet-overview-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcKeyValueListComponent,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverFleetWorldMapComponent,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './fleet-overview-page.component.html',
  standalone: true,
})
export class LoadweaverFleetOverviewPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);

  readonly cards = toSignal(this.facade.cards$, { initialValue: [] as FleetCard[] });
  readonly cardsLoading = toSignal(this.facade.cardsLoading$, { initialValue: false });
  readonly cardsError = toSignal(this.facade.cardsError$, { initialValue: null });
  readonly inbox = toSignal(this.facade.inbox$, { initialValue: [] as FleetInboxItem[] });
  readonly inboxError = toSignal(this.facade.inboxError$, { initialValue: null });
  readonly sites = toSignal(this.facade.sites$, { initialValue: null });
  readonly sitesError = toSignal(this.facade.sitesError$, { initialValue: null });
  readonly summary = toSignal(this.facade.summary$, {
    initialValue: {
      clusters: 0,
      healthy: 0,
      unhealthy: 0,
      critical: 0,
      attention: 0,
      upgrades: 0,
      pendingPlans: 0,
      openAlerts: 0,
      teardown: 0,
    },
  });

  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ search: this.search });
  readonly filteredCards = computed(() =>
    filterBySearch(this.cards(), this.search(), (c) => [c.name, c.version, c.state, c.health?.message]),
  );

  /** Phone lane switch (3.38): Clusters | Needs attention | Sites. */
  readonly lane = signal<'clusters' | 'attention' | 'sites'>('clusters');

  readonly located = computed(() => this.sites()?.sites ?? []);
  /** Located sites grouped by cluster for the list next to the map. */
  readonly sitesByCluster = computed(() => {
    const groups = new Map<string, { clusterId: string; clusterName: string; sites: FleetSite[] }>();

    for (const site of this.located()) {
      const group = groups.get(site.clusterId) ?? {
        clusterId: site.clusterId,
        clusterName: site.clusterName,
        sites: [],
      };

      group.sites.push(site);
      groups.set(site.clusterId, group);
    }

    return [...groups.values()].sort((a, b) => a.clusterName.localeCompare(b.clusterName));
  });
  /** The located sites per cluster beside the map. */
  readonly siteFacts = computed<FpcKeyValueItem[]>(() =>
    this.sitesByCluster().map((group) => ({
      key: group.clusterId,
      label: group.clusterName,
      value: group.sites.map((site) => site.label ?? site.site).join(', '),
    })),
  );

  readonly title = $localize`:@@lwConsoleFleetOverview-title:Fleet overview`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetOverview-refresh:Refresh`;
  readonly mapLabel = $localize`:@@lwConsoleFleetOverview-mapLabel:World map of sites`;
  readonly clustersLabel = $localize`:@@lwConsoleFleetOverview-sumClusters:Clusters`;
  readonly searchLabel = $localize`:@@lwConsoleFleetOverview-search:Search clusters`;
  readonly inboxTitle = $localize`:@@lwConsoleFleetOverview-inboxTitle:Needs attention`;
  readonly sitesTitle = $localize`:@@lwConsoleFleetOverview-sitesTitle:Sites`;
  readonly loadingLabel = $localize`:@@lwConsoleFleetOverview-loading:Loading clusters`;
  readonly versionLabel = $localize`:@@lwConsoleFleetOverview-version:Version`;
  readonly nodesLabel = $localize`:@@lwConsoleFleetOverview-nodes:Nodes up`;
  readonly alertsLabel = $localize`:@@lwConsoleFleetOverview-alerts:Open alerts`;
  readonly plansLabel = $localize`:@@lwConsoleFleetOverview-plans:Pending plans`;
  readonly detailsLabel = $localize`:@@lwConsoleFleetOverview-details:Connection & grants`;
  readonly teardownLabel = $localize`:@@lwConsoleFleetOverview-teardown:Teardown: read-only until`;
  readonly retiredLabel = $localize`:@@lwConsoleFleetOverview-retired:Retired`;
  readonly cloudLabel = $localize`:@@lwConsoleFleetOverview-cloud:Loadweaver Cloud`;
  readonly limitedLabel = $localize`:@@lwConsoleFleetOverview-limited:Project access`;
  readonly rolloutLabel = $localize`:@@lwConsoleFleetOverview-rollout:Update running`;
  /** 3.43: changes through the fleet are paused (unreachable / read-only). */
  readonly pausedLabel = $localize`:@@lwConsoleFleetOverview-paused:Changes paused`;
  readonly openNativeLabel = $localize`:@@lwConsoleFleetOverview-openNative:Open in the cluster's console`;
  readonly approveNativeLabel = $localize`:@@lwConsoleFleetOverview-approveNative:Approve in the cluster's console`;

  /** 3.38 D1: State (connection) · Cluster (+ flags) · health · version · nodes · alerts · plans · capacity. */
  readonly cardColumns: FpcTableColumn<FleetCard>[] = [
    {
      id: 'connection',
      label: $localize`:@@lwConsoleFleetOverview-colConnection:Connection`,
      type: 'state',
      // Read-only clusters (3.43) as such: they answer, but changes are paused.
      state: (card) => fleetConnectionState(card.connection, this.availability(card)),
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleFleetOverview-colCluster:Cluster`,
      value: (card) => card.name,
      required: true,
      priority: 1,
    },
    {
      id: 'health',
      label: $localize`:@@lwConsoleFleetOverview-colHealth:Health`,
      value: (card) => (card.health ? this.health(card.health.state) : ''),
      priority: 1,
    },
    { id: 'version', label: this.versionLabel, value: (card) => card.version ?? '', mono: true, priority: 2 },
    {
      id: 'nodes',
      label: this.nodesLabel,
      value: (card) => (!card.limited && card.nodes ? card.nodes.up : null),
      align: 'end',
      width: '7rem',
      priority: 2,
    },
    {
      id: 'alerts',
      label: this.alertsLabel,
      value: (card) => card.openAlerts ?? null,
      align: 'end',
      width: '7rem',
      priority: 2,
    },
    {
      id: 'plans',
      label: this.plansLabel,
      value: (card) => card.pendingPlans ?? null,
      align: 'end',
      width: '7rem',
      priority: 3,
    },
    { id: 'capacity', label: $localize`:@@lwConsoleFleetOverview-colCapacity:Capacity`, priority: 3 },
  ];

  /** Needs attention (3.38 D1): State (severity) · Title · cluster · project · since; click opens it. */
  readonly inboxColumns: FpcTableColumn<FleetInboxItem>[] = [
    {
      id: 'severity',
      label: $localize`:@@lwConsoleFleetOverview-colSeverity:Severity`,
      type: 'state',
      state: (item) => ({
        label: severityLabel(item.severity),
        tone: this.severityTone(item),
        icon: this.severityIcon(item).replace(/^bi-/, ''),
      }),
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleFleetOverview-colTitle:Title`,
      value: (item) => inboxItemTitle(item),
      required: true,
      priority: 1,
    },
    {
      id: 'cluster',
      label: $localize`:@@lwConsoleFleetOverview-colCluster:Cluster`,
      value: (item) => item.clusterName,
      priority: 1,
    },
    {
      id: 'project',
      label: $localize`:@@lwConsoleFleetOverview-colProject:Project`,
      value: (item) => item.project ?? '',
      priority: 2,
    },
    {
      id: 'since',
      label: $localize`:@@lwConsoleFleetOverview-colSince:Since`,
      value: (item) => item.since,
      priority: 2,
    },
    { id: 'native', label: $localize`:@@lwConsoleFleetOverview-colNative:Cluster console`, priority: 3 },
  ];
  readonly inboxTitleText = inboxItemTitle;

  /**
   * The summary's cluster card in the health vocabulary of the table (LW-19): healthy / all by the clusters' own health;
   * the tone of the worst one (failed or not reachable → danger, degraded / at risk / unknown → warning).
   */
  readonly clusterHealth = computed(() => {
    const cards = this.cards();
    const states = cards.map((card) =>
      card.connection.state === 'unreachable' || card.connection.state === 'credential-rejected'
        ? 'failed'
        : (card.health?.state ?? 'unknown'),
    );
    const healthy = states.filter((state) => state === 'healthy').length;
    const tone: 'success' | 'warning' | 'danger' = states.includes('failed')
      ? 'danger'
      : healthy < cards.length
        ? 'warning'
        : 'success';

    return { healthy, total: cards.length, tone };
  });

  readonly cardId = (card: FleetCard) => card.id;
  readonly inboxId = (item: FleetInboxItem) => item.clusterId + item.link + item.title;
  readonly cardMenu = (card: FleetCard): FpcMenuItem[] => [
    ...(card.state !== 'retired' ? [{ id: 'open', label: DL_OPEN, icon: 'box-arrow-in-right' }] : []),
    { id: 'details', label: this.detailsLabel, icon: 'sliders' },
  ];

  /** A cluster health headline for people (unknown states stay as they are). */
  health(state: string): string {
    return ['healthy', 'degraded', 'at-risk', 'failed', 'unknown'].includes(state)
      ? healthLabel(state as HealthState)
      : state;
  }

  /** Unreachable / read-only (3.43); older fleets: derived from the connection. */
  availability(card: FleetCard) {
    return card.availability ?? fleetAvailabilityOf({ health: card.connection });
  }

  /** "As of <time>" for counts from an earlier snapshot (3.43: the cluster doesn't answer). */
  asOfTitle(asOf: string): string {
    const at = new Date(asOf);
    const time = Number.isNaN(at.getTime()) ? asOf : at.toLocaleString();

    return $localize`:@@lwConsoleFleetOverview-asOf:As of ${time}:time: (the cluster doesn't answer)`;
  }

  readonly connectionTone = fleetConnectionTone;
  readonly connectionIcon = fleetConnectionIcon;
  readonly connectionLabel = fleetConnectionLabel;
  readonly roleLabel = fleetRoleLabel;
  readonly capacityPercent = fleetCapacityPercent;

  ngOnInit(): void {
    this.refresh();
    interval(FLEET_OVERVIEW_REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());
  }

  refresh(): void {
    this.facade.loadOverview();
  }

  /** Row click: open the cluster (retired ones only show their details). */
  activateCard(card: FleetCard): void {
    if (card.state !== 'retired') this.open(card);
    else void this.router.navigate(['/fleet/clusters', card.id]);
  }

  onCardAction(card: FleetCard, action: string): void {
    if (action === 'open') this.open(card);
    else if (action === 'details') void this.router.navigate(['/fleet/clusters', card.id]);
  }

  open(card: FleetCard): void {
    const target = fleetLinkTarget(card.link);

    this.facade.openCluster(card.id, target?.path ?? '/');
  }

  /**
   * Approvals on a cluster that doesn't trust the fleet (the backend sets `nativeUrl` only then): they open in the
   * cluster's own console; everything else is resolved in the fleet (2026-10-29).
   */
  isApproval(item: FleetInboxItem): boolean {
    return item.kind === 'approval' || item.kind === 'cross-project-request';
  }

  openItem(item: FleetInboxItem): void {
    // Trust problems (2026-10-29): resolved on the fleet's cluster page (Establish trust), not inside the cluster.
    if (item.kind === 'trust') {
      void this.router.navigate(['/fleet/clusters', item.clusterId]);

      return;
    }

    // Approvals on an untrusting cluster: the relayed page can't approve; the cluster's own console can.
    if (this.isApproval(item) && item.nativeUrl) {
      this.document.defaultView?.open(item.nativeUrl, '_blank', 'noopener,noreferrer');

      return;
    }

    const target = fleetLinkTarget(item.link);

    this.facade.openCluster(item.clusterId, target?.path ?? '/');
  }

  openSite(site: FleetSite): void {
    this.facade.openCluster(site.clusterId, '/resources/site/' + encodeURIComponent(site.site));
  }

  severityTone(item: FleetInboxItem): 'danger' | 'warning' | 'info' {
    return item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'info';
  }

  severityIcon(item: FleetInboxItem): string {
    return item.severity === 'critical'
      ? 'bi-x-octagon'
      : item.severity === 'warning'
        ? 'bi-exclamation-triangle'
        : 'bi-info-circle';
  }

  /** Whether the row shows a capacity line. */
  capacityText(card: FleetCard): boolean {
    return !!(this.capacityPercent(card.capacity, 'cpu') || this.capacityPercent(card.capacity, 'memory'));
  }

  /** High usage reads as a warning / danger text. */
  capacityClass(percent: number): string {
    return percent >= 90 ? 'text-danger' : percent >= 75 ? 'text-warning-emphasis' : '';
  }

  /** The cluster's health headline tone (healthy / degraded / at risk / failed / unknown). */
  healthTone(card: FleetCard): 'success' | 'warning' | 'danger' | 'neutral' {
    switch (card.health?.state) {
      case 'healthy':
        return 'success';
      case 'degraded':
      case 'at-risk':
        return 'warning';
      case 'failed':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
