import { CommonModule, formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  isRolloutActive,
  type RolloutAction,
  type RolloutDiffEntry,
  type RolloutStep,
  type RolloutWave,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  type FpcKeyValueItem,
  FpcKeyValueListComponent,
  FpcListHeaderComponent,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSectionRowComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
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
import { approvalsAvailable } from '../access/access-format';
import { dlUserLabel } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';

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
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcKeyValueListComponent,
    FpcListHeaderComponent,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
  ],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
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

  /** Phone lane switch (3.37): Rollout | Changes. */
  readonly lane = signal<'rollout' | 'changes'>('rollout');
  readonly diffBy = signal<'node' | 'component'>('node');
  readonly confirmAction = signal<Exclude<RolloutAction, 'approve'> | null>(null);
  readonly approveOpen = signal(false);
  readonly emergency = signal(false);

  readonly current = computed(() => {
    const rollout = this.rollout();

    return rollout && rollout.id === this.id() ? rollout : null;
  });
  /** Fleet mode: approvals through the fleet only when the cluster verifies its identity claims (3.24). */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  private readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly actions = computed(() => {
    const rollout = this.current();

    const actions = rollout && this.isClusterAdmin() ? rolloutActions(rollout.status) : [];

    return approvalsAvailable(this.fleetMode, this.me()) ? actions : actions.filter((action) => action !== 'approve');
  });
  readonly diffGroups = computed(() => groupDiff(this.current()?.diff ?? [], this.diffBy()));
  /** The diff entries in group order (the table groups them by node / component). */
  readonly diffRows = computed(() => this.diffGroups().flatMap((group) => group.entries));
  readonly diffId = (entry: RolloutDiffEntry): string => `${entry.node}/${entry.component}`;
  readonly diffGroupOf = (entry: RolloutDiffEntry): string => entry[this.diffBy()];
  readonly diffColumns = computed<FpcTableColumn<RolloutDiffEntry>[]>(() => {
    const byNode = this.diffBy() === 'node';

    return [
      {
        id: 'subject',
        label: byNode
          ? $localize`:@@lwConsoleUpdateDetail-colComponent:Component`
          : $localize`:@@lwConsoleUpdateDetail-colNode:Node`,
        value: (entry) => (byNode ? entry.component : entry.node),
        mono: true,
        required: true,
        priority: 1,
      },
      {
        id: 'from',
        label: $localize`:@@lwConsoleUpdateDetail-colFrom:From`,
        value: (e) => e.from ?? '–',
        mono: true,
        priority: 2,
      },
      {
        id: 'to',
        label: $localize`:@@lwConsoleUpdateDetail-colTo:To`,
        value: (e) => e.to ?? '–',
        mono: true,
        priority: 1,
      },
      {
        id: 'method',
        label: $localize`:@@lwConsoleUpdateDetail-colMethod:Method`,
        value: (e) => e.method,
        priority: 2,
      },
    ];
  });
  /** All wave steps in order; the table groups them by wave (decision 2: steps as a table). */
  readonly steps = computed(() => this.waves().flatMap((wave) => wave.steps));
  readonly stepId = (step: RolloutStep): string => String(step.index);
  readonly stepWave = (step: RolloutStep): string => String(step.wave).padStart(4, '0');
  readonly waveGroupLabel = (key: string): string => {
    const wave = this.waves().find((w) => w.wave === Number(key));

    return wave ? waveLabel(wave.wave, wave.phase) : key;
  };
  readonly gatesOf = (step: RolloutStep) => step.gates;
  readonly stepColumns: FpcTableColumn<RolloutStep>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleUpdateDetail-colState:State`,
      type: 'state',
      state: (step) => ({ label: stepStateLabel(step.state), tone: STEP_STATE_TONE[step.state] }),
    },
    {
      id: 'node',
      label: $localize`:@@lwConsoleUpdateDetail-colNode:Node`,
      value: (step) => step.node,
      required: true,
      priority: 1,
    },
    { id: 'site', label: $localize`:@@lwConsoleUpdateDetail-colSite:Site`, value: (step) => step.site, priority: 3 },
    {
      id: 'kind',
      label: $localize`:@@lwConsoleUpdateDetail-colKind:Kind`,
      value: (step) => stepKindLabel(step.kind),
      priority: 3,
    },
    {
      id: 'version',
      label: $localize`:@@lwConsoleUpdateDetail-colVersion:Version`,
      value: (step) => (step.from || step.to ? `${step.from ?? '–'} → ${step.to ?? '–'}` : ''),
      mono: true,
      priority: 2,
    },
    {
      id: 'started',
      label: $localize`:@@lwConsoleUpdateDetail-colStarted:Started`,
      value: (step) => step.startedAt ?? '',
      priority: 1,
    },
    { id: 'gates', label: $localize`:@@lwConsoleUpdateDetail-colGates:Health gates`, priority: 2 },
    { id: 'error', label: $localize`:@@lwConsoleUpdateDetail-colError:Error`, priority: 2 },
  ];
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
  readonly loadingLabel = $localize`:@@lwConsoleUpdateDetail-loading:Loading the update plan`;
  private readonly locale = inject(LOCALE_ID);
  /** Planned / approved / started / finished (who and when). */
  readonly timeline = computed<FpcKeyValueItem[]>(() => {
    const r = this.current();
    const when = (value: string | null) => (value ? formatDate(value, 'short', this.locale) : null);

    if (!r) return [];

    return [
      {
        key: 'created',
        label: $localize`:@@lwConsoleUpdateDetail-created:Planned`,
        value: when(r.createdAt),
        hint: dlUserLabel(r.createdBy, r.createdByEmail) || null,
      },
      {
        key: 'approved',
        label: $localize`:@@lwConsoleUpdateDetail-approved:Approved`,
        value: when(r.approvedAt),
        hint: dlUserLabel(r.approvedBy, r.approvedByEmail) || null,
      },
      { key: 'started', label: $localize`:@@lwConsoleUpdateDetail-started:Started`, value: when(r.startedAt) },
      { key: 'finished', label: $localize`:@@lwConsoleUpdateDetail-finished:Finished`, value: when(r.finishedAt) },
    ];
  });
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
  readonly approveLabel = $localize`:@@lwConsoleUpdateDetail-approve:Approve`;
  readonly approveEmergencyLabel = $localize`:@@lwConsoleUpdateDetail-approveEmergency:Approve as emergency`;
  readonly actionIcon: Record<RolloutAction, string> = {
    approve: 'bi-check-lg',
    pause: 'bi-pause-fill',
    resume: 'bi-play-fill',
    rollback: 'bi-arrow-counterclockwise',
    cancel: 'bi-x-lg',
  };

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

  actionVariant(action: RolloutAction): 'primary' | 'dark' | 'danger' {
    if (action === 'approve' || action === 'resume') return 'primary';

    return action === 'rollback' || action === 'cancel' ? 'danger' : 'dark';
  }

  failedGates(wave: RolloutWave): number {
    return wave.steps.reduce((sum, step) => sum + step.gates.filter((g) => !g.ok).length, 0);
  }
}
