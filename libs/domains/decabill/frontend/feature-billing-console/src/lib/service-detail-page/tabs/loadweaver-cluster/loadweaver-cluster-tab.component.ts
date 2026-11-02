import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LoadweaverClusterService,
  type LoadweaverClusterHealth,
  type LoadweaverClusterInfo,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  type FpcBadgeColor,
  FpcDatePipe,
} from '@forepath/shared/frontend/ui-components';

/**
 * Service-detail tab of Decabill's `loadweaver` service kind: endpoint and health of the single-node cluster, how to
 * add further nodes (customer's own servers / provider accounts, never billed by Decabill) and the steps before a
 * cancellation (final backup, recovery kit). Read-only; a plain service call instead of an NgRx slice because the tab
 * loads one document and refreshes on demand.
 */
@Component({
  selector: 'framework-loadweaver-cluster-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FpcDatePipe,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './loadweaver-cluster-tab.component.html',
})
export class LoadweaverClusterTabComponent implements OnChanges {
  @Input({ required: true }) subscriptionId!: string;
  @Input({ required: true }) itemId!: string;
  @Input() adminMode = false;

  private readonly clusterService = inject(LoadweaverClusterService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cluster = signal<LoadweaverClusterInfo | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly healthLabel = computed(() => {
    const health = this.cluster()?.health;

    return health ? loadweaverHealthLabel(health) : '';
  });
  readonly healthColor = computed<FpcBadgeColor>(() => loadweaverHealthColor(this.cluster()?.health));
  readonly installerLine = computed(() => {
    const url = this.cluster()?.installerUrl;

    return url
      ? `curl -fsSL ${url} | sudo LOADWEAVER_JOIN_TOKEN=<token> bash -s -- --name <node> --endpoint-host <public host>`
      : null;
  });

  ngOnChanges(): void {
    this.refresh();
  }

  refresh(): void {
    if (!this.subscriptionId || !this.itemId) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.clusterService
      .getCluster(this.subscriptionId, this.itemId, this.adminMode)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cluster) => {
          this.cluster.set(cluster);
          this.loading.set(false);
        },
        error: () => {
          this.error.set($localize`:@@featureLoadweaverCluster-loadError:The cluster status could not be loaded.`);
          this.loading.set(false);
        },
      });
  }
}

export function loadweaverHealthLabel(health: LoadweaverClusterHealth): string {
  switch (health) {
    case 'provisioning':
      return $localize`:@@featureLoadweaverCluster-healthProvisioning:Provisioning`;
    case 'starting':
      return $localize`:@@featureLoadweaverCluster-healthStarting:Starting`;
    case 'healthy':
      return $localize`:@@featureLoadweaverCluster-healthHealthy:Healthy`;
    case 'degraded':
      return $localize`:@@featureLoadweaverCluster-healthDegraded:Console unavailable`;
    case 'unreachable':
      return $localize`:@@featureLoadweaverCluster-healthUnreachable:Unreachable`;
    case 'failed':
      return $localize`:@@featureLoadweaverCluster-healthFailed:Provisioning failed`;
    case 'removed':
      return $localize`:@@featureLoadweaverCluster-healthRemoved:Removed`;
  }
}

export function loadweaverHealthColor(health: LoadweaverClusterHealth | undefined): FpcBadgeColor {
  switch (health) {
    case 'healthy':
      return 'success';
    case 'degraded':
    case 'starting':
      return 'warning';
    case 'unreachable':
    case 'failed':
      return 'danger';
    case 'provisioning':
      return 'info';
    default:
      return 'secondary';
  }
}
