import { CommonModule } from '@angular/common';
import { consoleHomeCrumb } from '../objects/object-route';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ConsoleAccessFacade, ConsoleAlertsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  type FpcCrumb,
  FpcEmptyStateComponent,
  type FpcKeyValueItem,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  FpcDataTableComponent,
  FpcObjectHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';
import { filter, map } from 'rxjs';

import { healthLink } from '../health/health-format';
import {
  ALERT_STATE_TONE,
  alertStateLabel,
  isHealthKey,
  mayAcknowledge,
  SEVERITY_TONE,
  severityLabel,
} from './alert-format';
import { LoadweaverAlertSilenceModalComponent, type SilencePrefill } from './alert-silence-modal.component';
import { LoadweaverLaneComponent } from '../section/lane.component';

/** One entry of an alert's timeline. */
interface AlertTimelineEntry {
  id: string;
  at: string;
  by: string | null;
  state: FpcTableState;
}

/** One alert (3.18): what fired and why, its timeline, acknowledge, and a silence for its rule and key. */
@Component({
  selector: 'loadweaver-alert-detail-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcObjectHeaderComponent,
    FpcSectionRowComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverAlertSilenceModalComponent,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './alert-detail-page.component.html',
  standalone: true,
})
export class LoadweaverAlertDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleAlertsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly alert = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly acknowledging = toSignal(this.facade.acknowledging$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly projects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  /** Phone lane switch (3.37): Details | Timeline. */
  readonly lane = signal<'details' | 'timeline'>('details');
  readonly silenceOpen = signal(false);
  readonly prefill = computed<SilencePrefill | null>(() => {
    const alert = this.alert();

    return alert ? { rule: alert.rule, key: alert.key, project: alert.project } : null;
  });

  /** Alerts › this alert (the crumb is the way back to the list). */
  readonly crumbs = computed<FpcCrumb[]>(() => [
    consoleHomeCrumb(),
    { label: this.listLabel, link: '/observe/alerts' },
    { label: this.alert()?.title ?? this.title },
  ]);
  /** Details lane facts (`key` / `acknowledged` are rich templates). */
  readonly facts = computed<FpcKeyValueItem[]>(() => {
    const alert = this.alert();

    if (!alert) return [];

    return [
      { key: 'rule', label: $localize`:@@lwConsoleAlertDetail-rule:Rule`, value: alert.rule, mono: true },
      { key: 'key', label: $localize`:@@lwConsoleAlertDetail-key:Key`, value: alert.key },
      { key: 'project', label: $localize`:@@lwConsoleAlertDetail-project:Project`, value: alert.project },
      { key: 'value', label: $localize`:@@lwConsoleAlertDetail-value:Value`, value: alert.value },
      { key: 'acknowledged', label: $localize`:@@lwConsoleAlertDetail-acknowledged:Acknowledged`, value: '' },
    ];
  });

  /** The alert's timeline (decision 2: a feed as a table). */
  readonly timeline = computed<AlertTimelineEntry[]>(() => {
    const alert = this.alert();

    if (!alert) return [];

    const entries: AlertTimelineEntry[] = [
      {
        id: 'started',
        at: alert.startedAt,
        by: null,
        state: {
          label: $localize`:@@lwConsoleAlertDetail-started:Condition met`,
          tone: 'warning',
          icon: 'hourglass-split',
        },
      },
    ];

    if (alert.firedAt)
      entries.push({
        id: 'fired',
        at: alert.firedAt,
        by: null,
        state: { label: $localize`:@@lwConsoleAlertDetail-fired:Fired`, tone: 'danger', icon: 'bell-fill' },
      });
    if (alert.acknowledgedAt)
      entries.push({
        id: 'acknowledged',
        at: alert.acknowledgedAt,
        by: alert.acknowledgedBy,
        state: {
          label: $localize`:@@lwConsoleAlertDetail-acknowledgedAt:Acknowledged`,
          tone: 'info',
          icon: 'person-check',
        },
      });
    if (alert.resolvedAt)
      entries.push({
        id: 'resolved',
        at: alert.resolvedAt,
        by: null,
        state: { label: $localize`:@@lwConsoleAlertDetail-resolved:Resolved`, tone: 'success', icon: 'check-lg' },
      });

    return entries;
  });
  readonly timelineId = (entry: AlertTimelineEntry): string => entry.id;
  readonly timelineColumns: FpcTableColumn<AlertTimelineEntry>[] = [
    {
      id: 'event',
      label: $localize`:@@lwConsoleAlertDetail-colEvent:Event`,
      type: 'state',
      state: (entry) => entry.state,
      required: true,
    },
    {
      id: 'at',
      label: $localize`:@@lwConsoleAlertDetail-colAt:When`,
      value: (entry) => entry.at,
      required: true,
      priority: 1,
    },
    { id: 'by', label: $localize`:@@lwConsoleAlertDetail-colBy:By`, value: (entry) => entry.by ?? '', priority: 1 },
  ];

  readonly stateTone = ALERT_STATE_TONE;
  readonly stateLabel = alertStateLabel;
  readonly severityTone = SEVERITY_TONE;
  readonly severityLabel = severityLabel;
  readonly mayAcknowledge = mayAcknowledge;
  readonly isHealthKey = isHealthKey;
  readonly healthLink = healthLink;

  readonly title = $localize`:@@lwConsoleAlertDetail-title:Alert`;
  readonly listLabel = $localize`:@@lwConsoleAlerts-title:Alerts`;
  readonly loadingLabel = $localize`:@@lwConsoleAlertDetail-loading:Loading the alert`;
  readonly silenceLabel = $localize`:@@lwConsoleAlertDetail-silence:Silence`;
  readonly acknowledgeLabel = $localize`:@@lwConsoleAlertDetail-acknowledge:Acknowledge`;
  readonly detailsTitle = $localize`:@@lwConsoleAlertDetail-details:Details`;
  readonly timelineTitle = $localize`:@@lwConsoleAlertDetail-timeline:Timeline`;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        filter((id): id is string => !!id),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((id) => this.facade.open(id));
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }

  acknowledge(): void {
    const alert = this.alert();

    if (alert) this.facade.acknowledge(alert.id);
  }
}
