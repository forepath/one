import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleSlosFacade,
  type Slo,
  type SloState,
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
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcProgressRingComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import {
  budgetTone,
  budgetUsedPercent,
  burnsFast,
  formatBurnRate,
  formatPercent,
  SLO_STATE_ICON,
  SLO_STATE_TONE,
  SLO_STATES,
  sloHealthLink,
  sloKey,
  sloStateLabel,
  sortSlos,
} from './slo-format';

/** The API computes SLOs at most once a minute. */
const REFRESH_MS = 60_000;

/**
 * SLOs (3.25): availability and latency objectives of exposed services with error budget used, burn rate and monthly
 * uptime; most urgent first.
 */
@Component({
  selector: 'loadweaver-slos-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcProgressRingComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
  ],
  templateUrl: './slos-page.component.html',
  standalone: true,
})
export class LoadweaverSlosPageComponent implements OnInit {
  private readonly facade = inject(ConsoleSlosFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly slos = toSignal(this.facade.slos$, { initialValue: [] as Slo[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly counts = toSignal(this.facade.counts$, {
    initialValue: { total: 0, ok: 0, burning: 0, exhausted: 0, noData: 0 },
  });
  readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly project = signal('');
  readonly filtersOpen = signal(false);
  readonly state = signal<SloState | ''>('');
  readonly activeFilterCount = computed(() => (this.project() ? 1 : 0) + (this.state() ? 1 : 0));

  /** The filter's projects: memberships plus those of listed SLOs (cluster roles read every project). */
  readonly projects = computed(() =>
    [...new Set([...this.memberProjects(), ...this.slos().map((s) => s.project)])].sort(),
  );
  readonly shown = computed(() => {
    const state = this.state();

    return sortSlos(this.slos().filter((s) => !state || s.state === state));
  });

  readonly states = SLO_STATES;
  readonly stateTone = SLO_STATE_TONE;
  readonly stateIcon = SLO_STATE_ICON;
  readonly stateLabel = sloStateLabel;
  readonly sloKey = sloKey;
  readonly healthLink = sloHealthLink;
  readonly budgetTone = budgetTone;
  readonly budgetUsed = budgetUsedPercent;
  readonly burnsFast = burnsFast;
  readonly percent = formatPercent;
  readonly burnRate = formatBurnRate;

  readonly title = $localize`:@@lwConsoleSlos-title:SLOs`;
  readonly refreshLabel = $localize`:@@lwConsoleSlos-refresh:Refresh`;
  readonly projectFilterLabel = $localize`:@@lwConsoleSlos-projectFilter:Project`;
  readonly stateFilterLabel = $localize`:@@lwConsoleSlos-stateFilter:State`;
  readonly filtersLabel = $localize`:@@lwConsoleSlos-filters:Filters`;
  readonly budgetLabel = $localize`:@@lwConsoleSlos-budgetUsed:Error budget used`;

  ngOnInit(): void {
    this.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.project() || null, true));
  }

  load(): void {
    this.facade.load(this.project() || null);
  }

  onProjectChange(project: string): void {
    this.project.set(project);
    this.load();
  }

  clearFilters(): void {
    this.state.set('');

    if (this.project()) this.onProjectChange('');
  }

  logsQuery(slo: Slo): Record<string, string> {
    return { project: slo.project, deployment: slo.deployment, service: slo.service };
  }
}
