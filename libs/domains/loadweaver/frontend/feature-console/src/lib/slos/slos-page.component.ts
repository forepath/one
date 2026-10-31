import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
  FpcDataTableComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { filterBySearch } from '../list-search';
import { readOnlyAsOf } from '../overview/console-format';
import {
  budgetTone,
  budgetUsedPercent,
  burnsFast,
  formatBurnRate,
  formatPercent,
  SLO_STATE_TONE,
  SLO_STATES,
  sloHealthLink,
  sloKey,
  sloStateLabel,
  sortSlos,
} from './slo-format';
import { injectSectionScope, sectionQuery } from '../section/section-scope';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/** The API computes SLOs at most once a minute. */
const REFRESH_MS = 60_000;

/**
 * SLOs (3.25): availability and latency objectives of exposed services with error budget used, burn rate and monthly
 * uptime; most urgent first.
 *
 * Embeddable (3.38, project tab SLOs): the scope's `project` is the fixed default of the project filter (API-side;
 * picker and page header hidden, Refresh in the strip), no URL writes.
 */
@Component({
  selector: 'loadweaver-slos-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    NgTemplateOutlet,
  ],
  templateUrl: './slos-page.component.html',
  standalone: true,
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  // The budget bar of an objective cell stays short beside its numbers.
  styles: `
    .lw-slo__budget {
      min-width: 4rem;
      max-width: 8rem;
    }
  `,
})
export class LoadweaverSlosPageComponent implements OnInit {
  private readonly facade = inject(ConsoleSlosFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);
  /** The object scope when embedded in an object tab (3.38), else `null`. */
  readonly scope = injectSectionScope();

  readonly slos = toSignal(this.facade.slos$, { initialValue: [] as Slo[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly counts = toSignal(this.facade.counts$, {
    initialValue: { total: 0, ok: 0, burning: 0, exhausted: 0, noData: 0 },
  });
  readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  /** Embedded: the scope's project is the default (Clear all keeps it). */
  readonly project = signal(this.scope ? (sectionQuery(this.route, this.scope).get('project') ?? '') : '');
  readonly filtersOpen = signal(false);
  readonly state = signal<SloState | ''>('');

  /** The filter's projects: memberships plus those of listed SLOs (cluster roles read every project). */
  readonly projects = computed(() =>
    [...new Set([...this.memberProjects(), ...this.slos().map((s) => s.project)])].sort(),
  );
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ project: this.project, state: this.state, search: this.search }, () =>
    this.load(),
  );
  readonly shown = computed(() => {
    const state = this.state();

    return sortSlos(
      filterBySearch(
        this.slos().filter((s) => !state || s.state === state),
        this.search(),
        (s) => [sloKey(s), s.window, sloStateLabel(s.state), s.hosts],
      ),
    );
  });

  /** Read-only control plane (3.43): "as of <last stored sample> (read-only)" while the SLOs carry `asOf`. */
  readonly readOnlyNote = computed(() => {
    const asOf = this.slos().find((s) => s.asOf)?.asOf;

    return asOf ? readOnlyAsOf(asOf, this.locale) : null;
  });

  readonly states = SLO_STATES;
  readonly stateTone = SLO_STATE_TONE;
  readonly stateLabel = sloStateLabel;
  readonly sloKey = sloKey;
  readonly healthLink = sloHealthLink;
  readonly budgetTone = budgetTone;
  readonly budgetUsed = budgetUsedPercent;
  readonly burnsFast = burnsFast;
  readonly percent = formatPercent;
  readonly burnRate = formatBurnRate;

  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { project: this.project, state: this.state },
    search: this.search,
    url: this.scope ? false : undefined,
    open: this.filtersOpen,
    changed: () => this.load(),
  });
  readonly title = $localize`:@@lwConsoleSlos-title:SLOs`;
  readonly refreshLabel = $localize`:@@lwConsoleSlos-refresh:Refresh`;
  readonly projectFilterLabel = $localize`:@@lwConsoleSlos-projectFilter:Project`;
  readonly stateFilterLabel = $localize`:@@lwConsoleSlos-stateFilter:State`;
  readonly searchLabel = $localize`:@@lwConsoleSlos-search:Search SLOs`;
  readonly healthLabel = $localize`:@@lwConsoleSlos-health:Health`;
  readonly logsLabel = $localize`:@@lwConsoleSlos-logs:Logs`;
  readonly budgetLabel = $localize`:@@lwConsoleSlos-budgetUsed:Error budget used`;
  readonly burnRateLabel = $localize`:@@lwConsoleSlos-burnRate:Burn rate (1 h)`;
  readonly availabilityLabel = $localize`:@@lwConsoleSlos-availability:Availability`;
  readonly latencyLabel = $localize`:@@lwConsoleSlos-latency:Latency`;
  readonly loadingLabel = $localize`:@@lwConsoleSlos-loading:Loading SLOs`;

  /** 3.38 D1: State · SLO (→ health) · window · uptime · availability · latency (budget bars) · hosts; ⋮ health / logs. */
  readonly columns: FpcTableColumn<Slo>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleSlos-colState:State`,
      type: 'state',
      state: (slo) => ({ label: sloStateLabel(slo.state), tone: SLO_STATE_TONE[slo.state] }),
    },
    {
      id: 'slo',
      label: $localize`:@@lwConsoleSlos-colSlo:SLO`,
      value: (slo) => sloKey(slo),
      required: true,
      priority: 1,
    },
    { id: 'window', label: $localize`:@@lwConsoleSlos-colWindow:Window`, value: (slo) => slo.window, priority: 3 },
    {
      id: 'uptime',
      label: $localize`:@@lwConsoleSlos-monthlyUptime:Uptime this month`,
      value: (slo) => slo.monthlyUptime,
      align: 'end',
      priority: 1,
    },
    { id: 'availability', label: this.availabilityLabel, priority: 2 },
    { id: 'latency', label: this.latencyLabel, priority: 2 },
    {
      id: 'hosts',
      label: $localize`:@@lwConsoleSlos-colHosts:Hosts`,
      value: (slo) => slo.hosts.join(', '),
      mono: true,
      priority: 3,
    },
  ];
  readonly rowId = (slo: Slo) => sloKey(slo);
  readonly rowLink = (slo: Slo) =>
    sloHealthLink(slo)
      .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
      .join('/');
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'health', label: this.healthLabel, icon: 'heart-pulse' },
    { id: 'logs', label: this.logsLabel, icon: 'journal-text' },
  ];

  ngOnInit(): void {
    this.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.project() || null, true));
  }

  load(): void {
    this.facade.load(this.project() || null);
  }

  onRowAction(slo: Slo, action: string): void {
    if (action === 'health') void this.router.navigate(sloHealthLink(slo));
    else if (action === 'logs') void this.router.navigate(['/observe/logs'], { queryParams: this.logsQuery(slo) });
  }

  logsQuery(slo: Slo): Record<string, string> {
    return { project: slo.project, deployment: slo.deployment, service: slo.service };
  }
}
