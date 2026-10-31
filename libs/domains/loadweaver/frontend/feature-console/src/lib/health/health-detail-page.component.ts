import { CommonModule } from '@angular/common';
import { consoleHomeCrumb } from '../objects/object-route';
import { Component, computed, DestroyRef, inject, input, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleHealthFacade,
  type HealthChange,
  type HealthReason,
  type HealthState,
  type HealthTreeNode,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  type FpcCrumb,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcDataTableComponent,
  FpcObjectHeaderComponent,
  FpcProgressComponent,
  type FpcProgressSegment,
  FpcSectionRowComponent,
  FpcStatusBadgeComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, distinctUntilChanged, filter, interval, map } from 'rxjs';

import { HEALTH_ICON, HEALTH_TONE, healthLabel } from '../overview/console-format';
import {
  formatDuration,
  formatInstants,
  HEALTH_BADGE_TONE,
  HEALTH_KIND_ICON,
  healthEntityRef,
  healthKindLabel,
  healthLink,
  healthReasonLabel,
} from './health-format';
import { LoadweaverHealthTreeComponent } from './health-tree.component';
import { LoadweaverAutoscalingPanelComponent } from '../autoscaling/autoscaling-panel.component';
import { autoscaleScopeOfHealthKey } from '../autoscaling/autoscaling-format';
import { LoadweaverLaneComponent } from '../section/lane.component';

const REFRESH_MS = 30_000;
const DAY_MS = 86_400_000;
const STATES: HealthState[] = ['healthy', 'degraded', 'at-risk', 'failed', 'unknown'];
const PROGRESS_VARIANT: Record<HealthState, FpcProgressSegment['variant']> = {
  healthy: 'success',
  degraded: 'warning',
  'at-risk': 'warning',
  failed: 'danger',
  unknown: 'secondary',
};

/** One health entity (3.25): state, reasons, descendants, state changes and the time spent per state. */
@Component({
  selector: 'loadweaver-health-detail-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcDataTableComponent,
    FpcObjectHeaderComponent,
    FpcProgressComponent,
    FpcStatusBadgeComponent,
    LoadweaverHealthTreeComponent,
    LoadweaverAutoscalingPanelComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './health-detail-page.component.html',
  standalone: true,
})
export class LoadweaverHealthDetailPageComponent implements OnInit {
  /** Rendered in an object page's Health tab (3.37): no page header, the entity from `entityKey`. */
  readonly embedded = input(false);
  readonly entityKey = input<string | null>(null);
  private readonly keyInput$ = toObservable(this.entityKey);
  private readonly facade = inject(ConsoleHealthFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  /** An affected entity as kind icon + name, not `kind/name` (D7, LW-04). */
  readonly entityRef = healthEntityRef;

  readonly entity = toSignal(this.facade.entity$, { initialValue: null });
  readonly children = toSignal(this.facade.children$, { initialValue: [] as HealthTreeNode[] });
  readonly loading = toSignal(this.facade.entityLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.entityError$, { initialValue: null });
  readonly history = toSignal(this.facade.history$, { initialValue: null });
  readonly historyLoading = toSignal(this.facade.historyLoading$, { initialValue: false });
  readonly historyError = toSignal(this.facade.historyError$, { initialValue: null });

  /** Phone lane switch (3.37): Why | Contains | State history. */
  readonly lane = signal<'reasons' | 'children' | 'history'>('reasons');
  readonly key = signal<string | null>(null);
  /** Deployments and services show their autoscaling (3.23). */
  readonly autoscaleScope = computed(() => autoscaleScopeOfHealthKey(this.key()));
  /** History range in days. */
  readonly rangeDays = signal(30);
  readonly ranges = [1, 7, 30, 90];

  readonly durations = computed(() => {
    const durations = this.history()?.durations ?? {};
    const total = STATES.reduce((sum, s) => sum + (durations[s] ?? 0), 0);

    return {
      total,
      rows: STATES.filter((s) => (durations[s] ?? 0) > 0).map((state) => ({
        state,
        ms: durations[state] ?? 0,
        share: total > 0 ? Math.round(((durations[state] ?? 0) / total) * 1000) / 10 : 0,
      })),
    };
  });
  readonly segments = computed<FpcProgressSegment[]>(() =>
    this.durations().rows.map((row) => ({
      value: row.share,
      variant: PROGRESS_VARIANT[row.state],
      label: `${healthLabel(row.state)}: ${formatDuration(row.ms)}`,
    })),
  );
  readonly changes = computed(() => [...(this.history()?.changes ?? [])].reverse());
  /** Health tree › parent › this entity. */
  readonly crumbs = computed<FpcCrumb[]>(() => {
    const entity = this.entity();
    const crumbs: FpcCrumb[] = [consoleHomeCrumb(), { label: this.title, link: '/observe/health' }];

    if (entity?.parent) crumbs.push({ label: entity.parent, link: healthLink(entity.parent) });

    crumbs.push({ label: entity?.name ?? this.key() ?? '' });

    return crumbs;
  });

  readonly healthTone = HEALTH_TONE;
  readonly badgeTone = HEALTH_BADGE_TONE;
  readonly healthIcon = HEALTH_ICON;
  readonly healthLabel = healthLabel;
  readonly kindIcon = HEALTH_KIND_ICON;
  readonly kindLabel = healthKindLabel;
  readonly formatDuration = formatDuration;
  readonly link = healthLink;

  readonly title = $localize`:@@lwConsoleHealthDetail-title:Health`;
  readonly sinceLabel = $localize`:@@lwConsoleHealthDetail-sinceLong:Since`;
  readonly loadingLabel = $localize`:@@lwConsoleHealthDetail-loading:Loading the entity`;
  readonly historyLoadingLabel = $localize`:@@lwConsoleHealthDetail-historyLoading:Loading the state history`;
  readonly rangeLabel = $localize`:@@lwConsoleHealthDetail-range:Range`;
  readonly historyTitle = $localize`:@@lwConsoleHealthDetail-history:State history`;
  readonly timeTitle = $localize`:@@lwConsoleHealthDetail-time:Time per state`;
  readonly childrenTitle = $localize`:@@lwConsoleHealthDetail-children:Contains`;
  readonly reasonsTitle = $localize`:@@lwConsoleHealthDetail-reasons:Why`;

  /** 3.38 D1: cause (readable code) · message · affected entities. */
  readonly reasonColumns: FpcTableColumn<HealthReason>[] = [
    {
      id: 'code',
      label: $localize`:@@lwConsoleHealthDetail-colCause:Cause`,
      value: (r) => healthReasonLabel(r.code),
      priority: 1,
    },
    {
      id: 'message',
      label: $localize`:@@lwConsoleHealthDetail-colMessage:Details`,
      value: (r) => formatInstants(r.message, this.locale),
      required: true,
      priority: 1,
    },
    { id: 'entities', label: $localize`:@@lwConsoleHealthDetail-colEntities:Affected` },
  ];
  readonly reasonId = (r: HealthReason) => `${r.code} ${r.message}`;
  /** 3.38 D1: State (new state) · time · previous state · message (newest first). */
  readonly changeColumns: FpcTableColumn<HealthChange>[] = [
    {
      id: 'to',
      label: $localize`:@@lwConsoleHealthDetail-colState:State`,
      type: 'state',
      state: (c) => ({
        label: healthLabel(c.to),
        tone: HEALTH_BADGE_TONE[c.to],
        icon: HEALTH_ICON[c.to].replace(/^bi-/, ''),
      }),
    },
    {
      id: 'at',
      label: $localize`:@@lwConsoleHealthDetail-colTime:Time`,
      value: (c) => c.at,
      priority: 1,
    },
    {
      id: 'message',
      label: $localize`:@@lwConsoleHealthDetail-colMessage:Details`,
      value: (c) => c.message,
      required: true,
      priority: 1,
    },
    {
      id: 'from',
      label: $localize`:@@lwConsoleHealthDetail-colFrom:Before`,
      value: (c) => (c.from ? healthLabel(c.from) : ''),
    },
  ];
  readonly changeId = (c: HealthChange) => `${c.at} ${c.to}`;

  ngOnInit(): void {
    combineLatest([this.keyInput$, this.route.paramMap])
      .pipe(
        map(([input, params]) => input ?? params.get('key')),
        filter((key): key is string => !!key),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((key) => {
        this.key.set(key);
        this.facade.loadEntity(key);
        this.loadHistory();
      });
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const key = this.key();

        if (key) this.facade.loadEntity(key, true);
      });
  }

  onRangeChange(days: number | string): void {
    this.rangeDays.set(Number(days));
    this.loadHistory();
  }

  rangeName(days: number): string {
    switch (days) {
      case 1:
        return $localize`:@@lwConsoleHealthDetail-range1:Last 24 hours`;
      case 7:
        return $localize`:@@lwConsoleHealthDetail-range7:Last 7 days`;
      case 30:
        return $localize`:@@lwConsoleHealthDetail-range30:Last 30 days`;
      default:
        return $localize`:@@lwConsoleHealthDetail-rangeDays:Last ${days}:days: days`;
    }
  }

  /** Reason entities are entity keys where they name one (`volume/shop/db-data`). */
  isEntityKey(value: string): boolean {
    return /^(cluster|site|node|project|deployment|service|replica|volume)(\/|$)/.test(value);
  }

  private loadHistory(): void {
    const key = this.key();

    if (!key) return;

    const to = new Date();
    const from = new Date(to.getTime() - this.rangeDays() * DAY_MS);

    this.facade.loadHistory(key, from.toISOString(), to.toISOString());
  }
}
