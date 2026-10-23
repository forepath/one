import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleFleetFacade,
  isFleetClusterId,
  type FleetAuditEntry,
  type FleetAuditFilter,
  type FleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcPagerComponent,
  FpcPanelComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

const PAGE_SIZES = [25, 50, 100, 250, 500];

/**
 * The fleet's audit log (fleet admins): connections, grants, relayed changes, socket attachments of terminals,
 * operations and Cloud hooks; newest first, filtered by cluster and action, paged by sequence number. Filters live
 * in the URL. (Each cluster's own audit log records relayed changes with the acting user as on-behalf-of.)
 */
@Component({
  selector: 'loadweaver-fleet-audit-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPagerComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './fleet-audit-page.component.html',
  standalone: true,
})
export class LoadweaverFleetAuditPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly clusters = toSignal(this.facade.clusters$, { initialValue: [] as FleetCluster[] });
  readonly entries = toSignal(this.facade.auditEntries$, { initialValue: [] as FleetAuditEntry[] });
  readonly page = toSignal(this.facade.auditPage$, { initialValue: 0 });
  readonly hasNext = toSignal(this.facade.auditHasNext$, { initialValue: false });
  readonly hasPrevious = toSignal(this.facade.auditHasPrevious$, { initialValue: false });
  readonly loading = toSignal(this.facade.auditLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.auditError$, { initialValue: null });

  readonly cluster = signal('');
  readonly action = signal('');
  readonly limit = signal(50);
  readonly filtersOpen = signal(false);
  readonly expanded = signal<string | null>(null);

  readonly activeFilterCount = computed(() => (this.cluster() ? 1 : 0) + (this.action().trim() ? 1 : 0));

  readonly pageSizes = PAGE_SIZES;
  readonly title = $localize`:@@lwConsoleFleetAudit-title:Fleet audit log`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetAudit-refresh:Refresh`;
  readonly filtersLabel = $localize`:@@lwConsoleFleetAudit-filters:Filters`;
  readonly searchLabel = $localize`:@@lwConsoleFleetAudit-search:Search`;
  readonly actionPlaceholder = $localize`:@@lwConsoleFleetAudit-actionPlaceholder:Action (e.g. relay.request)`;
  readonly pageLabel = $localize`:@@lwConsoleFleetAudit-page:Page`;
  readonly newerLabel = $localize`:@@lwConsoleFleetAudit-newer:Newer`;
  readonly olderLabel = $localize`:@@lwConsoleFleetAudit-older:Older`;
  readonly pageSizeLabel = $localize`:@@lwConsoleFleetAudit-pageSize:Entries per page`;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const cluster = params.get('cluster') ?? '';

    this.cluster.set(isFleetClusterId(cluster) ? cluster : '');
    this.action.set(params.get('action') ?? '');
    this.facade.loadClusters();
    this.search();
  }

  filter(): FleetAuditFilter {
    return {
      ...(this.cluster() ? { cluster: this.cluster() } : {}),
      ...(this.action().trim() ? { action: this.action().trim() } : {}),
    };
  }

  search(): void {
    const filter = this.filter();

    this.expanded.set(null);
    this.facade.searchAudit(filter, this.limit());
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: { cluster: filter.cluster ?? null, action: filter.action ?? null },
    });
  }

  reset(): void {
    this.cluster.set('');
    this.action.set('');
    this.search();
  }

  onLimitChange(limit: number | string): void {
    this.limit.set(Number(limit));
    this.search();
  }

  older(): void {
    this.facade.nextAuditPage();
  }

  newer(): void {
    this.facade.previousAuditPage();
  }

  toggle(entry: FleetAuditEntry): void {
    this.expanded.set(this.expanded() === entry.seq ? null : entry.seq);
  }

  clusterName(id: string | null): string {
    if (!id) return '';

    return this.clusters().find((c) => c.id === id)?.name ?? id.slice(0, 8);
  }

  details(entry: FleetAuditEntry): string {
    return JSON.stringify(entry.details ?? {}, null, 2);
  }
}
