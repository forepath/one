import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  type ConsoleResource,
  ConsoleResourcesFacade,
  type ResourceKindInfo,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import {
  kindIcon,
  matchesResourceSearch,
  projectParams,
  resourceDescription,
  resourceKey,
  resourceLink,
} from './resource-format';

/** The value of the project filter that selects cluster-level resources. */
export const CLUSTER_SCOPE = '-';

/**
 * Resources (3.29): the desired state the caller may read, by kind and project. Opening one shows its YAML; changes
 * are made in the editor and always become a plan.
 */
@Component({
  selector: 'loadweaver-resources-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './resources-page.component.html',
  standalone: true,
})
export class LoadweaverResourcesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleResourcesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly resources = toSignal(this.facade.resources$, { initialValue: [] as ConsoleResource[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly counts = toSignal(this.facade.counts$, { initialValue: {} as Record<string, number> });
  readonly kindInfos = toSignal(this.facade.kinds$, { initialValue: [] as ResourceKindInfo[] });
  private readonly resourceProjects = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  private readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  readonly seesInfrastructure = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly kind = signal('');
  readonly project = signal('');
  readonly search = signal('');

  /** Kinds with resources first, then the other published kinds. */
  readonly kinds = computed(() => {
    const counts = this.counts();

    return [...new Set([...Object.keys(counts), ...this.kindInfos().map((k) => k.kind)])].sort(
      (a, b) => Number(!counts[a]) - Number(!counts[b]) || a.localeCompare(b),
    );
  });
  readonly projects = computed(() => [...new Set([...this.resourceProjects(), ...this.memberProjects()])].sort());
  readonly filtered = computed(() => {
    const kind = this.kind();
    const project = this.project();
    const search = this.search();

    return this.resources()
      .filter(
        (r) =>
          (!kind || r.kind === kind) &&
          (!project || (project === CLUSTER_SCOPE ? !r.metadata.project : r.metadata.project === project)) &&
          matchesResourceSearch(r, search),
      )
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          (a.metadata.project ?? '').localeCompare(b.metadata.project ?? '') ||
          a.metadata.name.localeCompare(b.metadata.name),
      );
  });
  readonly kindDescription = computed(() => this.kindInfos().find((k) => k.kind === this.kind())?.description ?? null);

  readonly clusterScope = CLUSTER_SCOPE;
  readonly kindIcon = kindIcon;
  readonly description = resourceDescription;

  readonly title = $localize`:@@lwConsoleResources-title:Resources`;
  readonly refreshLabel = $localize`:@@lwConsoleResources-refresh:Refresh`;
  readonly kindFilterLabel = $localize`:@@lwConsoleResources-kindFilter:Kind`;
  readonly projectFilterLabel = $localize`:@@lwConsoleResources-projectFilter:Project`;
  readonly searchLabel = $localize`:@@lwConsoleResources-search:Search resources`;
  readonly clusterLabel = $localize`:@@lwConsoleResources-cluster:Cluster`;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;

    this.kind.set(params.get('kind') ?? '');
    this.project.set(params.get('project') ?? '');
    this.facade.load();
    this.facade.loadKinds();
  }

  refresh(): void {
    this.facade.load();
  }

  count(kind: string): number {
    return this.counts()[kind] ?? 0;
  }

  open(resource: ConsoleResource): void {
    void this.router.navigate(resourceLink(resourceKey(resource)), {
      queryParams: projectParams(resource.metadata.project),
    });
  }

  /** A new resource of the selected kind (Deployment by default) in the selected project. */
  create(): void {
    const project = this.project() && this.project() !== CLUSTER_SCOPE ? this.project() : undefined;

    void this.router.navigate(['/resources', 'new'], {
      queryParams: { kind: this.kind() || 'Deployment', ...(project ? { project } : {}) },
    });
  }
}
