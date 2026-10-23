import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePlansFacade,
  type Plan,
  type PlanListQuery,
  type PlanStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcCollapsibleFilterPanelComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import {
  PLAN_STATUS_ICON,
  PLAN_STATUS_TONE,
  PLAN_STATUSES,
  planProjects,
  planStatusLabel,
  planSummary,
  planTouched,
} from './plan-format';
import { LoadweaverPlanSourceComponent } from './plan-source.component';

const REFRESH_MS = 60_000;
const LIST_LIMIT = 100;

/**
 * Plans (3.8): the newest plans with status, author, creation time and the projects they touch; live over
 * `socket/plans` (status and progress), filtered by status and project on the server (`GET /plans?status=&project=`)
 * and again locally for plans the socket adds.
 */
@Component({
  selector: 'loadweaver-plans-page',
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
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    LoadweaverPlanSourceComponent,
  ],
  templateUrl: './plans-page.component.html',
  standalone: true,
})
export class LoadweaverPlansPageComponent implements OnInit, OnDestroy {
  private readonly facade = inject(ConsolePlansFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly plans = toSignal(this.facade.plans$, { initialValue: [] as Plan[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly live = toSignal(this.facade.live$, { initialValue: false });
  private readonly planProjects$ = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  private readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly status = signal<PlanStatus | ''>('');
  readonly project = signal('');
  readonly filtersOpen = signal(false);
  readonly activeFilterCount = computed(() => (this.status() ? 1 : 0) + (this.project() ? 1 : 0));

  readonly projects = computed(() => [...new Set([...this.planProjects$(), ...this.memberProjects()])].sort());
  readonly filtered = computed(() => {
    const status = this.status();
    const project = this.project();

    return this.plans().filter(
      (p) => (!status || p.status === status) && (!project || planProjects(p).includes(project)),
    );
  });

  readonly statuses = PLAN_STATUSES;
  readonly statusTone = PLAN_STATUS_TONE;
  readonly statusIcon = PLAN_STATUS_ICON;
  readonly statusLabel = planStatusLabel;
  readonly summary = planSummary;
  readonly projectsOf = planProjects;
  readonly touchedCount = (plan: Plan) => planTouched(plan).length;

  readonly title = $localize`:@@lwConsolePlans-title:Plans`;
  readonly refreshLabel = $localize`:@@lwConsolePlans-refresh:Refresh`;
  readonly statusFilterLabel = $localize`:@@lwConsolePlans-statusFilter:Status`;
  readonly projectFilterLabel = $localize`:@@lwConsolePlans-projectFilter:Project`;
  readonly filtersLabel = $localize`:@@lwConsolePlans-filters:Filters`;

  ngOnInit(): void {
    this.facade.load(this.query());
    this.facade.connectLive();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.query(), true));
  }

  ngOnDestroy(): void {
    this.facade.disconnectLive();
  }

  refresh(): void {
    this.facade.load(this.query());
  }

  setStatus(status: PlanStatus | ''): void {
    this.status.set(status);
    this.facade.load(this.query());
  }

  setProject(project: string): void {
    this.project.set(project);
    this.facade.load(this.query());
  }

  clearFilters(): void {
    this.status.set('');
    this.project.set('');
    this.facade.load(this.query());
  }

  /** The list's server filters. */
  private query(): PlanListQuery {
    const status = this.status();
    const project = this.project();

    return { limit: LIST_LIMIT, ...(status ? { status } : {}), ...(project ? { project } : {}) };
  }

  open(plan: Plan): void {
    void this.router.navigate(['/plans', plan.id]);
  }

  shortId(id: string): string {
    return id.slice(0, 8);
  }
}
