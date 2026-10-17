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
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { healthLabel } from '../overview/console-format';
import { countStates, unhealthyOnly } from './health-format';
import { LoadweaverHealthTreeComponent } from './health-tree.component';

const REFRESH_MS = 30_000;
const STATES: HealthState[] = ['failed', 'at-risk', 'degraded', 'unknown', 'healthy'];

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
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    LoadweaverHealthTreeComponent,
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

  readonly shown = computed(() => (this.onlyUnhealthy() ? unhealthyOnly(this.tree()) : this.tree()));
  readonly counts = computed(() => {
    const counts = countStates(this.tree());

    return STATES.map((state) => ({ state, count: counts[state] ?? 0 }));
  });

  readonly healthLabel = healthLabel;
  readonly title = $localize`:@@lwConsoleHealth-title:Health`;
  readonly projectLabel = $localize`:@@lwConsoleHealth-project:Project`;
  readonly refreshLabel = $localize`:@@lwConsoleHealth-refresh:Refresh`;

  ngOnInit(): void {
    this.facade.loadTree();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.loadTree(this.project() || undefined, true));
  }

  onProjectChange(project: string): void {
    this.project.set(project);
    this.facade.loadTree(project || undefined);
  }

  refresh(): void {
    this.facade.loadTree(this.project() || undefined);
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
