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
  type AlertSilence,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval } from 'rxjs';

import { saveFile } from '../live/live-format';
import {
  ALERT_STATE_ICON,
  ALERT_STATE_TONE,
  alertStateLabel,
  mayAcknowledge,
  SEVERITY_TONE,
  severityLabel,
  silenceStatus,
  silenceStatusLabel,
} from './alert-format';
import { LoadweaverAlertSilenceModalComponent } from './alert-silence-modal.component';

const REFRESH_MS = 30_000;

/** The state filter: the API knows open / resolved / all; firing and pending narrow `open`. */
export type AlertStateFilter = 'open' | 'firing' | 'pending' | 'resolved' | 'all';

/** Alerts (3.18): firing, pending and resolved alerts with filters, acknowledgements, silences and the export. */
@Component({
  selector: 'loadweaver-alerts-page',
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverAlertSilenceModalComponent,
  ],
  templateUrl: './alerts-page.component.html',
  standalone: true,
})
export class LoadweaverAlertsPageComponent implements OnInit {
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
  readonly silences = toSignal(this.facade.silences$, { initialValue: [] as AlertSilence[] });
  readonly silencesLoading = toSignal(this.facade.silencesLoading$, { initialValue: false });
  readonly silencesError = toSignal(this.facade.silencesError$, { initialValue: null });
  readonly silencesExpired = toSignal(this.facade.silencesExpired$, { initialValue: false });
  readonly endingSilence = toSignal(this.facade.endingSilence$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly activeTab = signal<string | null>('alerts');
  readonly stateFilter = signal<AlertStateFilter>('open');
  readonly severity = signal<AlertSeverity | ''>('');
  readonly project = signal('');
  readonly silenceOpen = signal(false);
  readonly silenceToEnd = signal<AlertSilence | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);

  readonly filtered = computed(() => {
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
  readonly stateIcon = ALERT_STATE_ICON;
  readonly stateLabel = alertStateLabel;
  readonly severityTone = SEVERITY_TONE;
  readonly severityLabel = severityLabel;
  readonly mayAcknowledge = mayAcknowledge;
  readonly silenceStatus = silenceStatus;
  readonly silenceStatusLabel = silenceStatusLabel;

  readonly title = $localize`:@@lwConsoleAlerts-title:Alerts`;
  readonly tabAlerts = $localize`:@@lwConsoleAlerts-tabAlerts:Alerts`;
  readonly tabSilences = $localize`:@@lwConsoleAlerts-tabSilences:Silences`;
  readonly refreshLabel = $localize`:@@lwConsoleAlerts-refresh:Refresh`;
  readonly stateFilterLabel = $localize`:@@lwConsoleAlerts-stateFilter:State`;
  readonly severityFilterLabel = $localize`:@@lwConsoleAlerts-severityFilter:Severity`;
  readonly projectFilterLabel = $localize`:@@lwConsoleAlerts-projectFilter:Project`;
  readonly acknowledgeLabel = $localize`:@@lwConsoleAlerts-acknowledge:Acknowledge`;
  readonly endSilenceTitle = $localize`:@@lwConsoleAlerts-endSilenceTitle:End the silence now?`;
  readonly endSilenceMessage = $localize`:@@lwConsoleAlerts-endSilenceMessage:Matching alerts are sent again; the silence stays as history.`;
  readonly endSilenceConfirm = $localize`:@@lwConsoleAlerts-endSilenceConfirm:End silence`;
  readonly keepLabel = $localize`:@@lwConsoleAlerts-keep:Keep`;

  ngOnInit(): void {
    this.load();
    this.facade.loadSilences(false);
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

  onStateChange(state: AlertStateFilter): void {
    this.stateFilter.set(state);
    this.load();
  }

  onProjectChange(project: string): void {
    this.project.set(project);
    this.load();
  }

  load(): void {
    this.facade.load(this.query());
  }

  open(alert: Alert): void {
    void this.router.navigate(['/alerts', alert.id]);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }

  acknowledge(alert: Alert, event?: Event): void {
    event?.stopPropagation();
    this.facade.acknowledge(alert.id);
  }

  onExpiredChange(expired: boolean): void {
    this.facade.loadSilences(expired);
  }

  onEndDialogChange(open: boolean): void {
    if (!open) this.silenceToEnd.set(null);
  }

  confirmEndSilence(): void {
    const silence = this.silenceToEnd();

    if (silence) this.facade.endSilence(silence.id);

    this.silenceToEnd.set(null);
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
