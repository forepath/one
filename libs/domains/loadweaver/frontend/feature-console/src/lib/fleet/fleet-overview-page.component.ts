import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  ConsoleFleetFacade,
  type FleetCard,
  type FleetInboxItem,
  type FleetSite,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import {
  fleetCapacityPercent,
  fleetConnectionIcon,
  fleetConnectionLabel,
  fleetConnectionTone,
  fleetLinkTarget,
  fleetRoleLabel,
} from './fleet-format';
import { LoadweaverFleetWorldMapComponent } from './fleet-world-map.component';

/** How often the overview refreshes (the fleet caches the clusters' answers for 30 s by default). */
export const FLEET_OVERVIEW_REFRESH_MS = 60_000;

/**
 * Fleet overview (3.24 / 3.25): summary bar, one card per cluster (connection and health, sites, nodes, capacity,
 * version / upgrade, open alerts, pending plans, inbox counts, Loadweaver Cloud teardown / grace), the merged
 * needs-attention inbox and the world map of sites. A card or an inbox item opens that cluster through the relay.
 */
@Component({
  selector: 'loadweaver-fleet-overview-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    LoadweaverFleetWorldMapComponent,
  ],
  templateUrl: './fleet-overview-page.component.html',
  standalone: true,
})
export class LoadweaverFleetOverviewPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

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

  readonly title = $localize`:@@lwConsoleFleetOverview-title:Fleet overview`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetOverview-refresh:Refresh`;
  readonly mapLabel = $localize`:@@lwConsoleFleetOverview-mapLabel:World map of sites`;

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

  open(card: FleetCard): void {
    const target = fleetLinkTarget(card.link);

    this.facade.openCluster(card.id, target?.path ?? '/overview');
  }

  /** Approvals can't be given through the fleet (they open in the cluster's own console). */
  isApproval(item: FleetInboxItem): boolean {
    return item.kind === 'approval' || item.kind === 'cross-project-request';
  }

  openItem(item: FleetInboxItem): void {
    // Approvals: the relayed page can't approve; the cluster's own console can.
    if (this.isApproval(item) && item.nativeUrl) {
      this.document.defaultView?.open(item.nativeUrl, '_blank', 'noopener,noreferrer');

      return;
    }

    const target = fleetLinkTarget(item.link);

    this.facade.openCluster(item.clusterId, target?.path ?? '/overview');
  }

  openSite(site: FleetSite): void {
    this.facade.openCluster(site.clusterId, '/nodes');
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

  capacityVariant(percent: number): 'primary' | 'warning' | 'danger' {
    return percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'primary';
  }

  /** The cluster's health headline tone (healthy / degraded / at risk / failed / unknown). */
  healthTone(card: FleetCard): 'success' | 'warning' | 'danger' | 'secondary' {
    switch (card.health?.state) {
      case 'healthy':
        return 'success';
      case 'degraded':
      case 'at-risk':
        return 'warning';
      case 'failed':
        return 'danger';
      default:
        return 'secondary';
    }
  }
}
