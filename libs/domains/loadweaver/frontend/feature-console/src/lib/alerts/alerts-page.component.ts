import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  apiErrorMessage,
  AlertsService,
  ConsoleAccessFacade,
  ConsoleAlertsFacade,
  type Alert,
  type AlertExportFormat,
  type AlertListQuery,
  type AlertSeverity,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, dlOpenItem } from '../section/data-list';
import { MasterDetailState } from '../section/master-detail.component';
import { firstValueFrom, interval } from 'rxjs';

import { saveFile } from '../live/live-format';
import { ALERT_STATE_TONE, alertStateLabel, mayAcknowledge, SEVERITY_TONE, severityLabel } from './alert-format';
import { LoadweaverAlertSilencesLaneComponent } from './alert-silences-lane.component';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

const REFRESH_MS = 30_000;

/** The state filter: the API knows open / resolved / all; firing and pending narrow `open`. */
export type AlertStateFilter = 'open' | 'firing' | 'pending' | 'resolved' | 'all';

/**
 * Alerts (3.18): firing, pending and resolved alerts with filters, acknowledgements and the export. The silences are
 * their own lane (3.38): the master-detail shell's empty detail lane at ≥ xl, a lane tab of this column below xl.
 */
@Component({
  selector: 'loadweaver-alerts-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverAlertSilencesLaneComponent,
  ],
  templateUrl: './alerts-page.component.html',
  standalone: true,
})
export class LoadweaverAlertsPageComponent implements OnInit {
  /** The row open in the detail lane (3.37 P6 master-detail; null outside the shell). */
  readonly openId = computed(() => this.masterDetail?.selectedId() ?? null);
  private readonly masterDetail = inject(MasterDetailState, { optional: true });
  private readonly facade = inject(ConsoleAlertsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(AlertsService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  readonly alerts = toSignal(this.facade.alerts$, { initialValue: [] as Alert[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly acknowledging = toSignal(this.facade.acknowledging$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  /** Below xl: which lane fills the list column (Alerts | Silences); at ≥ xl the silences are the empty detail lane. */
  readonly lane = signal<'alerts' | 'silences'>('alerts');
  readonly stateFilter = signal<AlertStateFilter>('open');
  readonly severity = signal<AlertSeverity | ''>('');
  readonly project = signal('');
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly filtersOpen = signal(false);

  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding(
    { stateFilter: this.stateFilter, severity: this.severity, project: this.project, search: this.search },
    () => this.load(),
  );
  /** Applied filters + search in the URL; the drawers edit drafts until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { state: this.stateFilter, severity: this.severity, project: this.project },
    search: this.search,
    open: this.filtersOpen,
    changed: () => this.load(),
  });
  readonly filtered = computed(() =>
    filterBySearch(this.byFilters(), this.search(), (a) => [
      a.title,
      a.rule,
      a.key,
      a.project,
      a.acknowledgedBy,
      this.stateLabel(a.state),
      this.severityLabel(a.severity),
    ]),
  );

  readonly byFilters = computed(() => {
    const state = this.stateFilter();
    const severity = this.severity();

    return this.alerts().filter(
      (a) =>
        (state !== 'firing' && state !== 'pending' ? true : a.state === state) &&
        (!severity || a.severity === severity),
    );
  });

  readonly states: AlertStateFilter[] = ['open', 'firing', 'pending', 'resolved', 'all'];
  readonly severities: AlertSeverity[] = ['critical', 'warning', 'info'];
  readonly stateTone = ALERT_STATE_TONE;
  readonly stateLabel = alertStateLabel;
  readonly severityTone = SEVERITY_TONE;
  readonly severityToneOf = (alert: Alert) => SEVERITY_TONE[alert.severity];
  readonly severityLabel = severityLabel;
  readonly mayAcknowledge = mayAcknowledge;

  readonly title = $localize`:@@lwConsoleAlerts-title:Alerts`;
  readonly tabAlerts = $localize`:@@lwConsoleAlerts-tabAlerts:Alerts`;
  readonly tabSilences = $localize`:@@lwConsoleAlerts-tabSilences:Silences`;
  readonly searchLabel = $localize`:@@lwConsoleAlerts-search:Search alerts`;
  readonly loadingLabel = $localize`:@@lwConsoleAlerts-loading:Loading alerts`;
  readonly refreshLabel = $localize`:@@lwConsoleAlerts-refresh:Refresh`;
  readonly stateFilterLabel = $localize`:@@lwConsoleAlerts-stateFilter:State`;
  readonly severityFilterLabel = $localize`:@@lwConsoleAlerts-severityFilter:Severity`;
  readonly projectFilterLabel = $localize`:@@lwConsoleAlerts-projectFilter:Project`;
  readonly acknowledgeLabel = $localize`:@@lwConsoleAlerts-acknowledge:Acknowledge`;
  readonly exportCsvLabel = $localize`:@@lwConsoleAlerts-exportCsv:Export CSV`;
  readonly exportJsonLabel = $localize`:@@lwConsoleAlerts-exportJson:Export JSON`;
  readonly silencedLabel = $localize`:@@lwConsoleAlerts-silenced:Silenced`;

  /** 3.38 D1: State · Alert (link) · severity · project · started · acknowledged by · resolved · rule · key. */
  readonly columns: FpcTableColumn<Alert>[] = [
    {
      id: 'state',
      label: this.stateFilterLabel,
      type: 'state',
      state: (alert) => ({ label: alertStateLabel(alert.state), tone: ALERT_STATE_TONE[alert.state] }),
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleAlerts-colAlert:Alert`,
      value: (alert) => alert.title,
      required: true,
      priority: 1,
    },
    {
      id: 'severity',
      label: this.severityFilterLabel,
      value: (alert) => ({ critical: 0, warning: 1, info: 2 })[alert.severity],
      width: '7rem',
      priority: 1,
    },
    {
      id: 'silenced',
      label: this.silencedLabel,
      value: (alert) => (alert.silenced ? 1 : 0),
      width: '3rem',
      priority: 2,
    },
    { id: 'project', label: this.projectFilterLabel, value: (alert) => alert.project ?? '', priority: 2 },
    {
      id: 'started',
      label: $localize`:@@lwConsoleAlerts-colStarted:Started`,
      value: (alert) => alert.startedAt,
      priority: 2,
    },
    {
      id: 'acknowledgedBy',
      label: $localize`:@@lwConsoleAlerts-colAcknowledgedBy:Acknowledged by`,
      value: (alert) => alert.acknowledgedBy ?? '',
      priority: 3,
    },
    {
      id: 'resolved',
      label: $localize`:@@lwConsoleAlerts-colResolved:Resolved`,
      value: (alert) => alert.resolvedAt ?? '',
      priority: 3,
    },
    {
      id: 'rule',
      label: $localize`:@@lwConsoleAlerts-colRule:Rule`,
      value: (alert) => alert.rule,
      priority: 3,
      hidden: true,
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  /** The selected alerts that can be acknowledged (firing, not acknowledged yet); the server checks each one. */
  readonly acknowledgeable = computed(() => {
    const ids = new Set(this.selected());

    return this.alerts().filter((alert) => ids.has(alert.id) && mayAcknowledge(alert));
  });

  readonly alertLink = (alert: Alert): string => `/observe/alerts/${encodeURIComponent(alert.id)}`;
  readonly rowMenu = (alert: Alert): FpcMenuItem[] => [
    dlOpenItem(),
    ...(mayAcknowledge(alert)
      ? [{ id: 'acknowledge', label: this.acknowledgeLabel, icon: 'check2-square', dividerBefore: true }]
      : []),
    dlCopyIdItem(),
  ];

  ngOnInit(): void {
    this.load();
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.facade.load(this.query(), true));
  }

  stateName(state: AlertStateFilter): string {
    switch (state) {
      case 'open':
        return $localize`:@@lwConsoleAlerts-filterOpen:Open (firing and pending)`;
      case 'firing':
        return $localize`:@@lwConsoleAlerts-filterFiring:Firing`;
      case 'pending':
        return $localize`:@@lwConsoleAlerts-filterPending:Pending`;
      case 'resolved':
        return $localize`:@@lwConsoleAlerts-filterResolved:Resolved`;
      default:
        return $localize`:@@lwConsoleAlerts-filterAll:All`;
    }
  }

  /** The API filter for the current selection. */
  query(): AlertListQuery {
    const state = this.stateFilter();

    return {
      state: state === 'firing' || state === 'pending' ? 'open' : state,
      ...(this.project() ? { project: this.project() } : {}),
    };
  }

  load(): void {
    this.facade.load(this.query());
  }

  open(alert: Alert): void {
    void this.router.navigate(['/observe/alerts', alert.id]);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }

  onRowAction(alert: Alert, action: string): void {
    if (action === 'open') this.open(alert);
    else if (action === 'acknowledge') this.acknowledge(alert);
    else if (action === 'copy-id') fpcCopyText(alert.id);
  }

  /** Bulk Acknowledge: one call per alert (same endpoint + authorization as the row action), per-alert result. */
  async acknowledgeSelected(): Promise<void> {
    const alerts = this.acknowledgeable();

    if (alerts.length === 0) return;

    const result = await fpcRunBulk(alerts, (alert) => firstValueFrom(this.service.acknowledge(alert.id)));

    this.bulkResult.set(dlBulkSummary(result, (alert) => alert.title));
    this.selected.set([]);
    this.load();
  }

  acknowledge(alert: Alert, event?: Event): void {
    event?.stopPropagation();
    this.facade.acknowledge(alert.id);
  }

  /** The export carries the API's credentials, so it is fetched and saved instead of linked. */
  export(format: AlertExportFormat): void {
    this.exporting.set(true);
    this.exportError.set(null);
    this.service.export(this.query(), format).subscribe({
      next: (content) => {
        this.exporting.set(false);
        this.download(content, format);
      },
      error: (error: unknown) => {
        this.exporting.set(false);
        this.exportError.set(apiErrorMessage(error, 'Export failed'));
      },
    });
  }

  private download(content: string, format: AlertExportFormat): void {
    saveFile(this.document, content, `alerts-${new Date().toISOString().slice(0, 10)}.${format}`);
  }
}
