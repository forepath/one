import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ConsoleAccessFacade,
  ConsoleHealthFacade,
  type HealthState,
  type HealthTreeNode,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcListToolbarComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSectionRowComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { healthLabel } from '../overview/console-format';
import { NO_MATCHES_HINT, NO_MATCHES_TITLE } from '../list-search';
import { LoadweaverLaneComponent } from '../section/lane.component';
import { countStates, searchHealthTree, unhealthyOnly } from './health-format';
import { LoadweaverHealthTreeComponent } from './health-tree.component';

const REFRESH_MS = 30_000;
const STATES: HealthState[] = ['failed', 'at-risk', 'degraded', 'unknown', 'healthy'];
/** Summary-card glyphs (Bootstrap icon names) per health state. */
const HEALTH_ICONS: Record<HealthState, string> = {
  failed: 'x-octagon',
  'at-risk': 'exclamation-triangle',
  degraded: 'heart-pulse',
  unknown: 'question-circle',
  healthy: 'check2-circle',
};

/**
 * The explained health tree (3.25): cluster → site → node for cluster roles, project → deployment → service →
 * replica for everyone who may read the project; states with their machine-readable reasons.
 */
@Component({
  selector: 'loadweaver-health-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcListToolbarComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSectionRowComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    LoadweaverHealthTreeComponent,
    LoadweaverLaneComponent,
  ],
  templateUrl: './health-page.component.html',
  standalone: true,
})
export class LoadweaverHealthPageComponent implements OnInit {
  private readonly facade = inject(ConsoleHealthFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly tree = toSignal(this.facade.tree$, { initialValue: [] as HealthTreeNode[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });
  readonly seesInfrastructure = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly project = signal('');
  readonly onlyUnhealthy = signal(false);
  readonly filtersOpen = signal(false);
  readonly search = signal('');

  readonly shown = computed(() =>
    searchHealthTree(this.onlyUnhealthy() ? unhealthyOnly(this.tree()) : this.tree(), this.search()),
  );
  /** Entities in the lane (all levels). */
  readonly entityCount = computed(() => Object.values(countStates(this.shown())).reduce((sum, n) => sum + (n ?? 0), 0));
  readonly counts = computed(() => {
    const counts = countStates(this.tree());

    return STATES.map((state) => ({ state, count: counts[state] ?? 0 }));
  });

  readonly healthLabel = healthLabel;
  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { project: this.project, onlyUnhealthy: this.onlyUnhealthy },
    search: this.search,
    open: this.filtersOpen,
    changed: () => this.refresh(),
  });
  readonly title = $localize`:@@lwConsoleHealth-title:Health`;
  readonly projectLabel = $localize`:@@lwConsoleHealth-project:Project`;
  readonly refreshLabel = $localize`:@@lwConsoleHealth-refresh:Refresh`;
  readonly laneTitle = $localize`:@@lwConsoleHealth-entities:Entities`;
  readonly searchLabel = $localize`:@@lwConsoleHealth-search:Search health entities`;
  readonly loadingLabel = $localize`:@@lwConsoleHealth-loading:Loading health`;
  readonly noMatchesTitle = NO_MATCHES_TITLE;
  readonly noMatchesHint = NO_MATCHES_HINT;

  ngOnInit(): void {
    this.facade.loadTree();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.loadTree(this.project() || undefined, true));
  }

  refresh(): void {
    this.facade.loadTree(this.project() || undefined);
  }

  /** Faint summary-card glyph per health state. */
  icon(state: HealthState): string {
    return HEALTH_ICONS[state];
  }

  tone(state: HealthState, count: number): 'default' | 'success' | 'warning' | 'danger' {
    if (count === 0) return 'default';

    return state === 'failed'
      ? 'danger'
      : state === 'healthy'
        ? 'success'
        : state === 'unknown'
          ? 'default'
          : 'warning';
  }
}
