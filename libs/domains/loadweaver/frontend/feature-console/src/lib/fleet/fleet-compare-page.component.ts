import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleFleetFacade,
  isFleetClusterId,
  type FleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';

import { fleetCapacityPercent } from './fleet-format';

export const FLEET_COMPARE_MIN = 2;
export const FLEET_COMPARE_MAX = 8;

/**
 * Side-by-side comparison (3.25): versions (and whether they match), capacity, and policy drift between 2 to 8
 * clusters (Policy, ImagePolicy, BackupPolicy, MaintenanceWindow, AlertRule by spec hash). The selection lives in
 * the URL (`?clusters=<id>,<id>`). Needs cluster-wide grants on every cluster.
 */
@Component({
  selector: 'loadweaver-fleet-compare-page',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
  ],
  templateUrl: './fleet-compare-page.component.html',
  standalone: true,
})
export class LoadweaverFleetComparePageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly clusters = toSignal(this.facade.clusters$, { initialValue: [] as FleetCluster[] });
  readonly comparison = toSignal(this.facade.comparison$, { initialValue: null });
  readonly loading = toSignal(this.facade.comparisonLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.comparisonError$, { initialValue: null });

  readonly selected = signal<string[]>([]);
  readonly selectionOpen = signal(true);

  /** Clusters with a cluster-wide grant (the comparison needs one on each). */
  readonly selectable = computed(() =>
    this.clusters().filter((c) => c.access.clusterRole !== null && c.state !== 'retired'),
  );
  readonly canCompare = computed(
    () => this.selected().length >= FLEET_COMPARE_MIN && this.selected().length <= FLEET_COMPARE_MAX,
  );
  readonly names = computed(() =>
    Object.fromEntries((this.comparison()?.clusters ?? []).map((c) => [c.id, c.name] as const)),
  );

  readonly title = $localize`:@@lwConsoleFleetCompare-title:Compare clusters`;
  readonly selectionLabel = $localize`:@@lwConsoleFleetCompare-selection:Clusters to compare`;
  readonly compareLabel = $localize`:@@lwConsoleFleetCompare-compare:Compare`;

  readonly capacityPercent = fleetCapacityPercent;

  ngOnInit(): void {
    this.facade.loadClusters();

    const ids = (this.route.snapshot.queryParamMap.get('clusters') ?? '')
      .split(',')
      .filter((id) => isFleetClusterId(id))
      .slice(0, FLEET_COMPARE_MAX);

    this.selected.set(ids);

    if (ids.length >= FLEET_COMPARE_MIN) {
      this.selectionOpen.set(false);
      this.facade.compare(ids);
    } else {
      this.facade.clearComparison();
    }
  }

  isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  toggle(id: string, checked: boolean): void {
    const current = this.selected().filter((s) => s !== id);

    this.selected.set(checked ? [...current, id].slice(0, FLEET_COMPARE_MAX) : current);
  }

  compare(): void {
    if (!this.canCompare()) return;

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: { clusters: this.selected().join(',') },
    });
    this.selectionOpen.set(false);
    this.facade.compare(this.selected());
  }

  clear(): void {
    this.selected.set([]);
    this.facade.clearComparison();
  }

  name(id: string): string {
    return this.names()[id] ?? id;
  }

  /** Short spec hash of a policy on a cluster, `–` when missing there. */
  hash(value: string | null | undefined): string {
    return value ? value.slice(0, 10) : '–';
  }
}
