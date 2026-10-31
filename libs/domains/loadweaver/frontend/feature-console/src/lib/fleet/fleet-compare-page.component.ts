import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleFleetFacade,
  isFleetClusterId,
  type FleetCluster,
  type FleetComparison,
  type FleetDriftItem,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcListToolbarComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcDataTableComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { filterBySearch } from '../list-search';
import { fleetCapacityPercent } from './fleet-format';

type VersionRow = FleetComparison['versions'][number];
type CapacityRow = FleetComparison['capacity'][number];

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
    FpcListToolbarComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcDataTableComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTableCellDirective,
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

  readonly capacityPercent = fleetCapacityPercent;
  readonly loadingLabel = $localize`:@@lwConsoleFleetCompare-loading:Comparing clusters`;
  readonly versionsLabel = $localize`:@@lwConsoleFleetCompare-versions:Versions`;
  readonly capacityLabel = $localize`:@@lwConsoleFleetCompare-capacity:Capacity`;
  readonly driftLabel = $localize`:@@lwConsoleFleetCompare-drift:Policy drift`;
  readonly driftSearchLabel = $localize`:@@lwConsoleFleetCompare-searchDrift:Search policies`;

  readonly clusterRowId = (row: { clusterId: string }): string => row.clusterId;
  readonly driftRowId = (item: FleetDriftItem): string => `${item.kind}/${item.project ?? ''}/${item.name}`;

  private readonly clusterLabel = $localize`:@@lwConsoleFleetCompare-colCluster:Cluster`;
  readonly versionColumns: FpcTableColumn<VersionRow>[] = [
    { id: 'cluster', label: this.clusterLabel, value: (v) => this.name(v.clusterId), required: true },
    {
      id: 'version',
      label: $localize`:@@lwConsoleFleetCompare-colVersion:Version`,
      value: (v) => v.version ?? '–',
      mono: true,
    },
    {
      id: 'latest',
      label: $localize`:@@lwConsoleFleetCompare-colLatest:Latest available`,
      value: (v) => v.latestAvailable ?? '–',
      mono: true,
    },
  ];
  readonly capacityColumns: FpcTableColumn<CapacityRow>[] = [
    { id: 'cluster', label: this.clusterLabel, value: (r) => this.name(r.clusterId), required: true },
    {
      id: 'sites',
      label: $localize`:@@lwConsoleFleetCompare-colSites:Sites`,
      value: (r) => r.sites ?? '–',
      align: 'end',
    },
    {
      id: 'nodes',
      label: $localize`:@@lwConsoleFleetCompare-colNodes:Nodes up`,
      value: (r) => (r.nodes ? `${r.nodes.up} / ${r.nodes.total}` : '–'),
      align: 'end',
    },
    {
      id: 'cpu',
      label: $localize`:@@lwConsoleFleetCompare-colCpu:CPU`,
      value: (r) => this.percent(fleetCapacityPercent(r.capacity, 'cpu')),
      align: 'end',
    },
    {
      id: 'memory',
      label: $localize`:@@lwConsoleFleetCompare-colMemory:Memory`,
      value: (r) => this.percent(fleetCapacityPercent(r.capacity, 'memory')),
      align: 'end',
    },
  ];
  /** Kind, name, drift state, then one spec-hash column per compared cluster. */
  /** Policy drift (comparison grid, sticky first column): Kind · State (missing / different) · Name · one column per
   * cluster with the policy's variant (A, B, …: same letter = same content; no raw hashes, D11). */
  readonly driftColumns = computed<FpcTableColumn<FleetDriftItem>[]>(() => [
    { id: 'kind', label: $localize`:@@lwConsoleFleetCompare-colKind:Kind`, value: (i) => i.kind, required: true },
    {
      id: 'state',
      label: $localize`:@@lwConsoleFleetCompare-colState:Drift`,
      type: 'state',
      state: (i) =>
        i.state === 'missing'
          ? { label: this.missingLabel, tone: 'warning', icon: 'dash-circle' }
          : { label: this.differentLabel, tone: 'info', icon: 'arrow-left-right' },
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleFleetCompare-colName:Name`,
      value: (i) => (i.project ? `${i.project}/${i.name}` : i.name),
      mono: true,
    },
    ...(this.comparison()?.clusters ?? []).map(
      (c): FpcTableColumn<FleetDriftItem> => ({
        id: `cluster:${c.id}`,
        label: c.name,
        value: (i) => this.variant(i, c.id),
        align: 'center',
      }),
    ),
  ]);
  readonly missingLabel = $localize`:@@lwConsoleFleetCompare-missing:missing`;
  readonly differentLabel = $localize`:@@lwConsoleFleetCompare-different:different`;
  readonly driftQuery = signal('');
  readonly driftRows = computed(() =>
    filterBySearch(this.comparison()?.policyDrift.items ?? [], this.driftQuery(), (i) => [
      i.kind,
      i.project,
      i.name,
      i.state,
    ]),
  );

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

  percent(value: number | null): string {
    return value === null ? '–' : `${value}%`;
  }

  /** Short spec hash of a policy on a cluster, `–` when missing there. */
  /** The policy's variant on a cluster: A, B, … in order of appearance (same content = same letter), – if missing. */
  variant(item: FleetDriftItem, clusterId: string): string {
    const value = item.clusters[clusterId];

    if (!value) return '–';

    const order = [...new Set(Object.values(item.clusters).filter((v): v is string => !!v))];

    return String.fromCharCode(65 + Math.max(0, order.indexOf(value)));
  }
}
