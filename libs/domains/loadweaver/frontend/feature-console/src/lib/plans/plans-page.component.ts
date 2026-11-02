import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, OnDestroy, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsolePlansFacade,
  type Plan,
  type PlanListQuery,
  type PlanStatus,
  PlansService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcDatePipe,
  fpcListQueryState,
  fpcFormatDateTime,
  fpcPlural,
  fpcRunBulk,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, dlOpenItem, dlUserLabel } from '../section/data-list';
import { MasterDetailState } from '../section/master-detail.component';
import {
  PLAN_STATUS_BADGE_TONE,
  PLAN_STATUS_ICON,
  PLAN_STATUSES,
  planAction,
  planProjects,
  planStatusLabel,
  planSummary,
  planTouched,
} from './plan-format';
import { LoadweaverPlanSourceComponent } from './plan-source.component';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

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
    LoadweaverSavedViewsComponent,
    CommonModule,
    FpcDatePipe,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcTableCellDirective,
    LoadweaverPlanSourceComponent,
  ],
  templateUrl: './plans-page.component.html',
  // The meta line only in the rail's stacked cards (the table grid is an `fpc-data-table` size container).
  styles: [
    `
      .lw-plan-meta {
        display: none;
      }

      @container fpc-data-table (max-width: 36rem) {
        .lw-plan-meta {
          display: block;
        }
      }
    `,
  ],
  standalone: true,
})
export class LoadweaverPlansPageComponent implements OnInit, OnDestroy {
  /** The row open in the detail lane (3.37 P6 master-detail; null outside the shell). */
  readonly openId = computed(() => this.masterDetail?.selectedId() ?? null);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  private readonly locale = inject(LOCALE_ID);
  private readonly facade = inject(ConsolePlansFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly plansService = inject(PlansService);

  readonly plans = toSignal(this.facade.plans$, { initialValue: [] as Plan[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly live = toSignal(this.facade.live$, { initialValue: false });
  private readonly planProjects$ = toSignal(this.facade.projects$, { initialValue: [] as string[] });
  private readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly status = signal<PlanStatus | ''>('');
  readonly project = signal('');
  readonly filtersOpen = signal(false);

  readonly projects = computed(() => [...new Set([...this.planProjects$(), ...this.memberProjects()])].sort());
  readonly filtered = computed(() => {
    const status = this.status();
    const project = this.project();

    return this.plans().filter(
      (p) => (!status || p.status === status) && (!project || planProjects(p).includes(project)),
    );
  });

  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ status: this.status, project: this.project, search: this.search }, () =>
    this.refresh(),
  );
  /** Applied filters + search in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { status: this.status, project: this.project },
    search: this.search,
    open: this.filtersOpen,
    changed: () => this.refresh(),
  });
  readonly visible = computed(() =>
    filterBySearch(this.filtered(), this.search(), (p) => [
      p.id,
      planSummary(p, Number.MAX_SAFE_INTEGER),
      dlUserLabel(p.createdBy, p.createdByEmail),
      p.createdBy,
      this.statusLabel(p.status),
      planProjects(p),
    ]),
  );

  readonly statuses = PLAN_STATUSES;
  readonly badgeTone = PLAN_STATUS_BADGE_TONE;
  readonly statusLabel = planStatusLabel;
  readonly summary = planSummary;
  readonly projectsOf = planProjects;
  readonly touchedCount = (plan: Plan) => planTouched(plan).length;

  readonly title = $localize`:@@lwConsolePlans-title:Plans`;
  readonly loadingLabel = $localize`:@@lwConsolePlans-loading:Loading plans`;
  readonly refreshLabel = $localize`:@@lwConsolePlans-refresh:Refresh`;
  readonly searchLabel = $localize`:@@lwConsolePlans-search:Search plans`;
  readonly fixForwardLabel = $localize`:@@lwConsolePlans-fixForward:Fix-forward`;
  readonly discardLabel = $localize`:@@lwConsolePlans-discardSelected:Discard`;
  readonly discardHint = $localize`:@@lwConsolePlans-discardSelectedHint:Discard the selected pending plans`;

  /** 3.38 D1: State · Plan (link) · changes · author · source · projects · created · progress. */
  readonly columns: FpcTableColumn<Plan>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsolePlans-colStatus:Status`,
      type: 'state',
      state: (plan) => ({
        label: planStatusLabel(plan.status),
        tone: PLAN_STATUS_BADGE_TONE[plan.status],
        icon: PLAN_STATUS_ICON[plan.status].replace(/^bi-/, ''),
      }),
    },
    {
      id: 'summary',
      label: $localize`:@@lwConsolePlans-colPlan:Plan`,
      value: (plan) => planSummary(plan),
      required: true,
      priority: 1,
    },
    // Changes / author / created: columns in wide tables; the rail's stacked cards carry them in the Plan cell's meta
    // line instead (LW-07 round 2: action · n changes · author · exact time, so rows on one resource still differ).
    {
      id: 'changes',
      label: $localize`:@@lwConsolePlans-colChanges:Changes`,
      value: (plan) => planTouched(plan).length,
      align: 'end',
      width: '6rem',
      priority: 2,
    },
    {
      id: 'author',
      label: $localize`:@@lwConsolePlans-colAuthor:Author`,
      value: (plan) => dlUserLabel(plan.createdBy, plan.createdByEmail),
      priority: 2,
    },
    { id: 'source', label: $localize`:@@lwConsolePlans-colSource:Source`, priority: 3 },
    { id: 'projects', label: $localize`:@@lwConsolePlans-colProjects:Projects`, priority: 3 },
    {
      id: 'created',
      label: $localize`:@@lwConsolePlans-colCreated:Created`,
      value: (plan) => plan.createdAt,
      priority: 2,
    },
    { id: 'progress', label: $localize`:@@lwConsolePlans-colProgress:Progress`, width: '10rem' },
  ];

  /** The rail card's meta line (LW-07 round 2): shared action · n changes · author · exact time (no seconds). */
  readonly metaOf = (plan: Plan): string => {
    const changes = fpcPlural(
      planTouched(plan).length,
      {
        one: $localize`:@@lwConsolePlans-changeCountOne:{count} change`,
        other: $localize`:@@lwConsolePlans-changeCountOther:{count} changes`,
      },
      this.locale,
    );

    return [
      planAction(plan),
      changes,
      dlUserLabel(plan.createdBy, plan.createdByEmail),
      fpcFormatDateTime(plan.createdAt, this.locale),
    ]
      .filter(Boolean)
      .join(' · ');
  };

  readonly selected = signal<readonly string[]>([]);
  readonly confirmDiscard = signal(false);
  readonly discardConfirmTitle = $localize`:@@lwConsolePlans-discardConfirmTitle:Discard plans?`;
  readonly cancelLabel = $localize`:@@lwConsolePlans-cancel:Cancel`;
  readonly discardConfirmMessage = computed(
    () =>
      $localize`:@@lwConsolePlans-discardConfirmMessage:${this.selectedPlans().length}:count: selected pending plans will be discarded. Plans you may not discard are reported and left as they are.`,
  );
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  private readonly selectedPlans = computed(() => {
    const ids = new Set(this.selected());

    return this.plans().filter((plan) => ids.has(plan.id));
  });
  /** Only pending plans can be discarded; the server still checks every plan (creator / project role). */
  readonly canDiscardSelection = computed(
    () => this.selectedPlans().length > 0 && this.selectedPlans().every((plan) => plan.status === 'pending'),
  );

  readonly planLink = (plan: Plan): string => `/activity/plans/${encodeURIComponent(plan.id)}`;
  readonly rowMenu = (plan: Plan): FpcMenuItem[] => [
    dlOpenItem(),
    ...(plan.status === 'pending'
      ? [{ id: 'discard', label: this.discardLabel, icon: 'trash', danger: true, dividerBefore: true }]
      : []),
    dlCopyIdItem(),
  ];
  readonly statusFilterLabel = $localize`:@@lwConsolePlans-statusFilter:Status`;
  readonly projectFilterLabel = $localize`:@@lwConsolePlans-projectFilter:Project`;

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

  /** The list's server filters. */
  private query(): PlanListQuery {
    const status = this.status();
    const project = this.project();

    return { limit: LIST_LIMIT, ...(status ? { status } : {}), ...(project ? { project } : {}) };
  }

  open(plan: Plan): void {
    void this.router.navigate(['/activity/plans', plan.id]);
  }

  onRowAction(plan: Plan, action: string): void {
    if (action === 'open') this.open(plan);
    else if (action === 'discard') this.facade.discard(plan.id);
    else if (action === 'copy-id') fpcCopyText(plan.id);
  }

  /** Bulk Discard: one call per plan (same endpoint + authorization as the row action), per-plan result. */
  async discardSelected(): Promise<void> {
    const plans = this.selectedPlans().filter((plan) => plan.status === 'pending');

    if (plans.length === 0) return;

    const result = await fpcRunBulk(plans, (plan) => firstValueFrom(this.plansService.discard(plan.id)));

    this.bulkResult.set(dlBulkSummary(result, (plan) => planSummary(plan)));
    this.selected.set([]);
    this.refresh();
  }
}
