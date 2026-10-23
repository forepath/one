import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleHealthFacade,
  type HealthState,
  type HealthTreeNode,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  type FpcProgressSegment,
} from '@forepath/shared/frontend/ui-components';
import { filter, interval, map } from 'rxjs';

import { HEALTH_ICON, HEALTH_TONE, healthLabel } from '../overview/console-format';
import { formatDuration, HEALTH_KIND_ICON, healthKindLabel, healthLink } from './health-format';
import { LoadweaverHealthTreeComponent } from './health-tree.component';
import { LoadweaverAutoscalingPanelComponent } from '../autoscaling/autoscaling-panel.component';
import { autoscaleScopeOfHealthKey } from '../autoscaling/autoscaling-format';

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
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    LoadweaverHealthTreeComponent,
    LoadweaverAutoscalingPanelComponent,
  ],
  templateUrl: './health-detail-page.component.html',
  standalone: true,
})
export class LoadweaverHealthDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleHealthFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly entity = toSignal(this.facade.entity$, { initialValue: null });
  readonly children = toSignal(this.facade.children$, { initialValue: [] as HealthTreeNode[] });
  readonly loading = toSignal(this.facade.entityLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.entityError$, { initialValue: null });
  readonly history = toSignal(this.facade.history$, { initialValue: null });
  readonly historyLoading = toSignal(this.facade.historyLoading$, { initialValue: false });
  readonly historyError = toSignal(this.facade.historyError$, { initialValue: null });

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

  readonly healthTone = HEALTH_TONE;
  readonly healthIcon = HEALTH_ICON;
  readonly healthLabel = healthLabel;
  readonly kindIcon = HEALTH_KIND_ICON;
  readonly kindLabel = healthKindLabel;
  readonly formatDuration = formatDuration;
  readonly link = healthLink;

  readonly title = $localize`:@@lwConsoleHealthDetail-title:Health`;
  readonly backLabel = $localize`:@@lwConsoleHealthDetail-back:Health tree`;
  readonly rangeLabel = $localize`:@@lwConsoleHealthDetail-range:Range`;
  readonly historyTitle = $localize`:@@lwConsoleHealthDetail-history:State history`;
  readonly timeTitle = $localize`:@@lwConsoleHealthDetail-time:Time per state`;
  readonly childrenTitle = $localize`:@@lwConsoleHealthDetail-children:Contains`;
  readonly reasonsTitle = $localize`:@@lwConsoleHealthDetail-reasons:Why`;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('key')),
        filter((key): key is string => !!key),
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
