import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ConsoleAccessFacade, ConsoleAlertsFacade } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, map } from 'rxjs';

import { healthLink } from '../health/health-format';
import {
  ALERT_STATE_ICON,
  ALERT_STATE_TONE,
  alertStateLabel,
  isHealthKey,
  mayAcknowledge,
  SEVERITY_TONE,
  severityLabel,
} from './alert-format';
import { LoadweaverAlertSilenceModalComponent, type SilencePrefill } from './alert-silence-modal.component';

/** One alert (3.18): what fired and why, its timeline, acknowledge, and a silence for its rule and key. */
@Component({
  selector: 'loadweaver-alert-detail-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    LoadweaverAlertSilenceModalComponent,
  ],
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

  readonly silenceOpen = signal(false);
  readonly prefill = computed<SilencePrefill | null>(() => {
    const alert = this.alert();

    return alert ? { rule: alert.rule, key: alert.key, project: alert.project } : null;
  });

  readonly stateTone = ALERT_STATE_TONE;
  readonly stateIcon = ALERT_STATE_ICON;
  readonly stateLabel = alertStateLabel;
  readonly severityTone = SEVERITY_TONE;
  readonly severityLabel = severityLabel;
  readonly mayAcknowledge = mayAcknowledge;
  readonly isHealthKey = isHealthKey;
  readonly healthLink = healthLink;

  readonly title = $localize`:@@lwConsoleAlertDetail-title:Alert`;
  readonly backLabel = $localize`:@@lwConsoleAlertDetail-back:All alerts`;
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
