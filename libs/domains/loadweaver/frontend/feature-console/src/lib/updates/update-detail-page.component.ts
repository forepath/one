import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  isRolloutActive,
  type RolloutAction,
  type RolloutWave,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval, map } from 'rxjs';

import {
  formatVersion,
  groupDiff,
  progressPercent,
  ROLLOUT_STATUS_TONE,
  rolloutActionConfirm,
  rolloutActionLabel,
  rolloutActions,
  rolloutKindLabel,
  rolloutStatusLabel,
  STEP_STATE_TONE,
  stepKindLabel,
  stepStateLabel,
  UPDATES_POLL_MS,
  waveLabel,
} from './update-format';

/**
 * One update plan (3.26): the per-node / per-component diff, notes, warnings, the failure analysis and steps of every
 * wave with their state and health gates, and the actions for cluster admins (approve, also as an emergency outside
 * maintenance windows, pause, resume, roll back, cancel). Polls every 5 s while the rollout is in progress.
 */
@Component({
  selector: 'loadweaver-update-detail-page',
  imports: [
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
  ],
  templateUrl: './update-detail-page.component.html',
  standalone: true,
})
export class LoadweaverUpdateDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleUpdatesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('id') ?? '',
  });
  readonly rollout = toSignal(this.facade.selected$, { initialValue: null });
  readonly waves = toSignal(this.facade.selectedWaves$, { initialValue: [] as RolloutWave[] });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly acting = toSignal(this.facade.acting$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });

  readonly diffBy = signal<'node' | 'component'>('node');
  readonly confirmAction = signal<Exclude<RolloutAction, 'approve'> | null>(null);
  readonly approveOpen = signal(false);
  readonly emergency = signal(false);

  readonly current = computed(() => {
    const rollout = this.rollout();

    return rollout && rollout.id === this.id() ? rollout : null;
  });
  readonly actions = computed(() => {
    const rollout = this.current();

    return rollout && this.isClusterAdmin() ? rolloutActions(rollout.status) : [];
  });
  readonly diffGroups = computed(() => groupDiff(this.current()?.diff ?? [], this.diffBy()));
  readonly confirm = computed(() => {
    const action = this.confirmAction();

    return action ? rolloutActionConfirm(action) : null;
  });

  readonly statusTone = ROLLOUT_STATUS_TONE;
  readonly statusLabel = rolloutStatusLabel;
  readonly stepTone = STEP_STATE_TONE;
  readonly stepLabel = stepStateLabel;
  readonly stepKind = stepKindLabel;
  readonly kindLabel = rolloutKindLabel;
  readonly waveLabel = waveLabel;
  readonly actionLabel = rolloutActionLabel;
  readonly percent = progressPercent;
  readonly version = formatVersion;

  readonly title = $localize`:@@lwConsoleUpdateDetail-title:Update`;
  readonly backLabel = $localize`:@@lwConsoleUpdateDetail-back:Update plans`;
  readonly statusTitle = $localize`:@@lwConsoleUpdateDetail-status:Status`;
  readonly kindTitle = $localize`:@@lwConsoleUpdateDetail-kind:Kind`;
  readonly progressTitle = $localize`:@@lwConsoleUpdateDetail-progress:Progress`;
  readonly diffTitle = $localize`:@@lwConsoleUpdateDetail-diff:Changes`;
  readonly byNode = $localize`:@@lwConsoleUpdateDetail-byNode:By node`;
  readonly byComponent = $localize`:@@lwConsoleUpdateDetail-byComponent:By component`;
  readonly notesTitle = $localize`:@@lwConsoleUpdateDetail-notes:Notes`;
  readonly wavesTitle = $localize`:@@lwConsoleUpdateDetail-waves:Rollout`;
  readonly approveTitle = $localize`:@@lwConsoleUpdateDetail-approveTitle:Approve the update?`;
  readonly keepLabel = $localize`:@@lwConsoleUpdateDetail-keep:Back`;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');

      if (id) this.facade.open(id);
    });

    interval(UPDATES_POLL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const rollout = this.current();

        if (rollout && isRolloutActive(rollout)) this.facade.open(rollout.id, true);
      });
  }

  refresh(): void {
    if (this.id()) this.facade.open(this.id());
  }

  request(action: RolloutAction): void {
    this.facade.clearActionError();

    if (action === 'approve') {
      this.emergency.set(false);
      this.approveOpen.set(true);
    } else {
      this.confirmAction.set(action);
    }
  }

  approve(): void {
    const rollout = this.current();

    if (rollout) this.facade.act(rollout.id, 'approve', this.emergency());

    this.approveOpen.set(false);
  }

  onConfirmOpenChange(open: boolean): void {
    if (!open) this.confirmAction.set(null);
  }

  confirmed(): void {
    const rollout = this.current();
    const action = this.confirmAction();

    if (rollout && action) this.facade.act(rollout.id, action);

    this.confirmAction.set(null);
  }

  selectDiff(by: string | null): void {
    if (by === 'node' || by === 'component') this.diffBy.set(by);
  }

  actionVariant(action: RolloutAction): 'primary' | 'outline-secondary' | 'outline-danger' {
    if (action === 'approve' || action === 'resume') return 'primary';

    return action === 'rollback' || action === 'cancel' ? 'outline-danger' : 'outline-secondary';
  }

  failedGates(wave: RolloutWave): number {
    return wave.steps.reduce((sum, step) => sum + step.gates.filter((g) => !g.ok).length, 0);
  }
}
