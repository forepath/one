import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  apiErrorMessage,
  ConsoleFleetFacade,
  FleetService,
  type CreateFleetOperation,
  type FleetCluster,
  type FleetOperation,
  type FleetSourceBackup,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  fpcCopyText,
  fpcRunBulk,
  fpcListQueryState,
  FpcConfirmDialogComponent,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListHeaderComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { filter, firstValueFrom, interval, switchMap, take } from 'rxjs';

import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem } from '../section/data-list';
import { formatBytes } from '../overview/console-format';
import {
  FLEET_OPERATION_TONE,
  fleetCurrentStep,
  fleetOperationActive,
  fleetOperationKindLabel,
  fleetOperationProgress,
  fleetOperationStatusLabel,
  fleetStepLabel,
  fleetStepTone,
} from './fleet-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const VOLUME = /^[a-z0-9_.-]{1,63}$/;

/** While operations run, the list refreshes this often. */
export const FLEET_OPERATIONS_REFRESH_MS = 10_000;

/** A backup picked in the wizard with the volume it is restored into on the target. */
export interface WizardBackup {
  backup: FleetSourceBackup;
  selected: boolean;
  volume: string;
}

/** The default target volume: the last segment of the backup's resource (`volume/shop/db-data` → `db-data`). */
export function defaultTargetVolume(resource: string): string {
  const last = resource.split('/').pop() ?? '';

  return VOLUME.test(last) ? last : '';
}

export interface FleetOperationForm {
  kind: 'cross-cluster-restore' | 'clone';
  sourceClusterId: string;
  sourceProject: string;
  targetClusterId: string;
  targetProject: string;
  targetDeployment: string;
  cloneProject: string;
  cloneDeployment: string;
  mode: 'replace' | 'merge';
  apply: boolean;
}

export function emptyOperationForm(): FleetOperationForm {
  return {
    kind: 'cross-cluster-restore',
    sourceClusterId: '',
    sourceProject: '',
    targetClusterId: '',
    targetProject: '',
    targetDeployment: '',
    cloneProject: '',
    cloneDeployment: '',
    mode: 'replace',
    apply: false,
  };
}

/** The request of the wizard, or the reason it can't be sent yet. */
export function buildOperation(
  form: FleetOperationForm,
  backups: readonly WizardBackup[],
): { operation: CreateFleetOperation } | { error: string } {
  const picked = backups.filter((b) => b.selected);

  if (!form.sourceClusterId || !form.targetClusterId)
    return { error: $localize`:@@lwConsoleFleetOps-errClusters:Choose the source and the target cluster.` };

  if (picked.length === 0 || picked.length > 16)
    return { error: $localize`:@@lwConsoleFleetOps-errBackups:Choose 1 to 16 backups.` };

  if (picked.some((b) => !VOLUME.test(b.volume.trim())))
    return { error: $localize`:@@lwConsoleFleetOps-errVolume:Every backup needs a target volume name.` };

  if (!NAME.test(form.targetProject.trim()) || !NAME.test(form.targetDeployment.trim()))
    return { error: $localize`:@@lwConsoleFleetOps-errTarget:Target project and deployment are required.` };

  if (form.kind === 'clone' && (!NAME.test(form.cloneProject.trim()) || !NAME.test(form.cloneDeployment.trim())))
    return { error: $localize`:@@lwConsoleFleetOps-errClone:Cloning needs the source project and deployment.` };

  return {
    operation: {
      kind: form.kind,
      sourceClusterId: form.sourceClusterId,
      targetClusterId: form.targetClusterId,
      backups: picked.map((b) => ({ backupId: b.backup.id, volume: b.volume.trim() })),
      target: { project: form.targetProject.trim(), deployment: form.targetDeployment.trim() },
      ...(form.kind === 'clone'
        ? { clone: { project: form.cloneProject.trim(), deployment: form.cloneDeployment.trim() } }
        : {}),
      mode: form.mode,
      apply: form.apply,
    },
  };
}

/**
 * Fleet operations (3.20): cross-cluster restores and clones (and Loadweaver Cloud final backups) with their steps
 * and progress, cancel at the fleet; the wizard picks the source cluster and backups, the target cluster, project
 * and deployment, and whether the target applies the plans (its approvals still hold).
 */
@Component({
  selector: 'loadweaver-fleet-operations-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcDataTableComponent,
    FpcListHeaderComponent,
    FpcProgressComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
  ],
  templateUrl: './fleet-operations-page.component.html',
  standalone: true,
})
export class LoadweaverFleetOperationsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleFleetFacade);
  private readonly service = inject(FleetService);
  private readonly destroyRef = inject(DestroyRef);

  readonly clusters = toSignal(this.facade.clusters$, { initialValue: [] as FleetCluster[] });
  readonly operations = toSignal(this.facade.operations$, { initialValue: [] as FleetOperation[] });
  readonly loading = toSignal(this.facade.operationsLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.operationsError$, { initialValue: null });
  readonly saving = toSignal(this.facade.operationSaving$, { initialValue: false });
  readonly saveError = toSignal(this.facade.operationError$, { initialValue: null });
  readonly cancelling = toSignal(this.facade.cancelling$, { initialValue: [] as string[] });

  readonly clusterFilter = signal('');
  readonly search = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ clusterFilter: this.clusterFilter, search: this.search }, () => this.refresh());
  readonly filtersOpen = signal(false);
  readonly expanded = signal<string | null>(null);
  readonly cancelFor = signal<FleetOperation | null>(null);

  readonly wizardOpen = signal(false);
  readonly wizardError = signal<string | null>(null);
  readonly backups = signal<WizardBackup[]>([]);
  readonly backupsLoading = signal(false);
  readonly backupsError = signal<string | null>(null);
  readonly backupsLoaded = signal(false);
  form: FleetOperationForm = emptyOperationForm();

  /** Clusters that can take part (not retired); targets must not be in their read-only grace. */
  readonly sources = computed(() => this.clusters().filter((c) => c.state !== 'retired'));
  readonly targets = computed(() => this.clusters().filter((c) => c.state === 'active' && !c.access.readOnly));
  readonly filtered = computed(() =>
    filterBySearch(this.operations(), this.search(), (op) => [
      this.kindLabel(op.kind),
      this.statusLabel(op.status),
      op.sourceClusterId ? this.clusterName(op.sourceClusterId) : null,
      this.clusterName(op.targetClusterId),
      op.error,
    ]),
  );

  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { cluster: this.clusterFilter },
    search: this.search,
    open: this.filtersOpen,
    changed: () => this.refresh(),
  });
  readonly title = $localize`:@@lwConsoleFleetOps-title:Fleet operations`;
  readonly newLabel = $localize`:@@lwConsoleFleetOps-new:Restore or clone across clusters`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetOps-refresh:Refresh`;
  readonly wizardTitle = $localize`:@@lwConsoleFleetOps-wizardTitle:Cross-cluster restore / clone`;
  readonly cancelTitle = $localize`:@@lwConsoleFleetOps-cancelTitle:Cancel the operation?`;
  readonly cancelMessage = $localize`:@@lwConsoleFleetOps-cancelMessage:The fleet stops it. Imports and plans the clusters already created stay visible there.`;
  readonly cancelConfirm = $localize`:@@lwConsoleFleetOps-cancelConfirm:Cancel operation`;
  readonly keepLabel = $localize`:@@lwConsoleFleetOps-keep:Keep running`;
  readonly closeLabel = $localize`:@@lwConsoleFleetOps-close:Close`;
  readonly cancelLabel = $localize`:@@lwConsoleFleetOps-cancel:Cancel`;
  readonly searchLabel = $localize`:@@lwConsoleFleetOps-search:Search operations`;
  readonly loadingLabel = $localize`:@@lwConsoleFleetOps-loading:Loading operations`;
  readonly sourceTitle = $localize`:@@lwConsoleFleetOps-source:Source`;
  readonly targetTitle = $localize`:@@lwConsoleFleetOps-target:Target`;
  readonly backupsLabel = $localize`:@@lwConsoleFleetOps-backups:Source backups`;
  readonly backupColumns: FpcTableColumn<WizardBackup>[] = [
    { id: 'pick', label: '', sortable: false, required: true, width: '2.5rem' },
    {
      id: 'backup',
      label: $localize`:@@lwConsoleFleetOps-colBackup:Backup`,
      value: (b) => b.backup.resource,
      required: true,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleFleetOps-colSize:Size`,
      value: (b) => formatBytes(b.backup.bytes),
      align: 'end',
      sortable: false,
    },
    { id: 'volume', label: $localize`:@@lwConsoleFleetOps-colVolume:Target volume`, sortable: false },
  ];
  readonly backupRowId = (b: WizardBackup): string => b.backup.id;
  readonly stepsTitle = $localize`:@@lwConsoleFleetOps-steps:Steps`;

  /** 3.38 D1: State · Operation (kind) · clusters · current step · progress · created; steps in the row detail. */
  readonly columns: FpcTableColumn<FleetOperation>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleFleetOps-colStatus:Status`,
      type: 'state',
      state: (op) => ({ label: fleetOperationStatusLabel(op.status), tone: FLEET_OPERATION_TONE[op.status] }),
    },
    {
      id: 'kind',
      label: $localize`:@@lwConsoleFleetOps-colOperation:Operation`,
      value: (op) => fleetOperationKindLabel(op.kind),
      required: true,
      priority: 1,
    },
    {
      id: 'clusters',
      label: $localize`:@@lwConsoleFleetOps-colClusters:Clusters`,
      value: (op) =>
        (op.sourceClusterId ? `${this.clusterName(op.sourceClusterId)} → ` : '') + this.clusterName(op.targetClusterId),
      priority: 1,
    },
    {
      id: 'step',
      label: $localize`:@@lwConsoleFleetOps-colStep:Current step`,
      value: (op) => {
        const step = fleetCurrentStep(op);

        return step ? fleetStepLabel(step) : '';
      },
      priority: 2,
    },
    { id: 'progress', label: $localize`:@@lwConsoleFleetOps-colProgress:Progress`, width: '9rem', priority: 2 },
    {
      id: 'created',
      label: $localize`:@@lwConsoleFleetOps-colCreated:Created`,
      value: (op) => op.createdAt,
      priority: 2,
    },
    {
      id: 'error',
      label: $localize`:@@lwConsoleFleetOps-colError:Error`,
      value: (op) => op.error ?? '',
      priority: 3,
    },
  ];

  /** The steps (nested, decision 2): State · Step · attempts · finished · detail / error. */
  readonly stepColumns: FpcTableColumn<FleetOperation['steps'][number]>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleFleetOps-colStatus:Status`,
      type: 'state',
      state: (step) => ({ label: fleetOperationStatusLabel(step.status), tone: fleetStepTone(step.status) }),
    },
    {
      id: 'step',
      label: $localize`:@@lwConsoleFleetOps-colStepName:Step`,
      value: (step) => fleetStepLabel(step.key),
      required: true,
      priority: 1,
    },
    {
      id: 'attempts',
      label: $localize`:@@lwConsoleFleetOps-colAttempts:Attempts`,
      value: (step) => step.attempts,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    {
      id: 'finished',
      label: $localize`:@@lwConsoleFleetOps-colFinished:Finished`,
      value: (step) => step.finishedAt,
      priority: 1,
    },
    { id: 'detail', label: $localize`:@@lwConsoleFleetOps-colDetail:Detail`, priority: 2 },
  ];
  readonly stepId = (step: FleetOperation['steps'][number]) => step.key;
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkCancel = signal(false);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  private readonly picked = computed(() => {
    const ids = new Set(this.selected());

    return this.operations().filter((op) => ids.has(op.id));
  });
  /** Only running operations can be cancelled. */
  readonly canCancelSelection = computed(
    () => this.picked().length > 0 && this.picked().every((op) => fleetOperationActive(op)),
  );
  readonly bulkCancelMessage = computed(
    () =>
      $localize`:@@lwConsoleFleetOps-bulkCancelMessage:${this.picked().length}:count: selected operations are stopped. Imports and plans the clusters already created stay. Operations you may not cancel are reported and left as they are.`,
  );
  readonly rowMenu = (op: FleetOperation): FpcMenuItem[] => [
    ...(fleetOperationActive(op)
      ? [
          {
            id: 'cancel',
            label: this.cancelLabel,
            icon: 'x-circle',
            danger: true,
            disabled: this.cancelling().includes(op.id),
          },
        ]
      : []),
    { ...dlCopyIdItem(), dividerBefore: fleetOperationActive(op) },
  ];

  readonly statusTone = FLEET_OPERATION_TONE;
  readonly statusLabel = fleetOperationStatusLabel;
  readonly kindLabel = fleetOperationKindLabel;
  readonly progress = fleetOperationProgress;
  readonly currentStep = fleetCurrentStep;
  readonly active = fleetOperationActive;
  readonly stepTone = fleetStepTone;
  readonly formatBytes = formatBytes;

  ngOnInit(): void {
    this.facade.loadClusters();
    this.refresh();
    this.facade.operationCreated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((action) => {
      this.wizardOpen.set(false);
      this.expanded.set(action.operation.id);
    });
    // Refresh while something runs.
    interval(FLEET_OPERATIONS_REFRESH_MS)
      .pipe(
        switchMap(() => this.facade.hasActiveOperations$.pipe(take(1))),
        filter(Boolean),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.refresh());
  }

  refresh(): void {
    this.facade.loadOperations(this.clusterFilter() || null);
  }

  clusterName(id: string | null): string {
    if (!id) return '–';

    return this.clusters().find((c) => c.id === id)?.name ?? id.slice(0, 8);
  }

  toggle(operation: FleetOperation): void {
    this.expanded.set(this.expanded() === operation.id ? null : operation.id);
  }

  detail(value: Record<string, unknown>): string {
    return Object.keys(value ?? {}).length > 0 ? JSON.stringify(value) : '';
  }

  /** Bulk Cancel: one call per running operation (same endpoint + authorization as the row action). */
  async cancelSelected(): Promise<void> {
    const operations = this.picked().filter((op) => fleetOperationActive(op));

    if (operations.length === 0) return;

    const result = await fpcRunBulk(operations, (op) => firstValueFrom(this.service.cancelOperation(op.id)));

    this.bulkResult.set(
      dlBulkSummary(result, (op) => `${fleetOperationKindLabel(op.kind)} (${this.clusterName(op.targetClusterId)})`),
    );
    this.selected.set([]);
    this.refresh();
  }

  onRowAction(operation: FleetOperation, action: string): void {
    if (action === 'cancel') this.askCancel(operation);
    else if (action === 'copy-id') fpcCopyText(operation.id);
  }

  askCancel(operation: FleetOperation, event?: Event): void {
    event?.stopPropagation();
    this.cancelFor.set(operation);
  }

  onCancelOpenChange(open: boolean): void {
    if (!open) this.cancelFor.set(null);
  }

  confirmCancel(): void {
    const operation = this.cancelFor();

    if (operation) this.facade.cancelOperation(operation.id);

    this.cancelFor.set(null);
  }

  openWizard(): void {
    this.form = emptyOperationForm();
    this.backups.set([]);
    this.backupsLoaded.set(false);
    this.backupsError.set(null);
    this.wizardError.set(null);
    this.facade.resetOperationForm();
    this.wizardOpen.set(true);
  }

  onSourceChange(): void {
    this.backups.set([]);
    this.backupsLoaded.set(false);
    this.backupsError.set(null);
  }

  loadBackups(): void {
    if (!this.form.sourceClusterId) return;

    this.backupsLoading.set(true);
    this.backupsError.set(null);
    this.service.sourceBackups(this.form.sourceClusterId, this.form.sourceProject.trim() || null).subscribe({
      next: (backups) => {
        this.backupsLoading.set(false);
        this.backupsLoaded.set(true);
        this.backups.set(
          backups.map((backup) => ({ backup, selected: false, volume: defaultTargetVolume(backup.resource) })),
        );
      },
      error: (error: unknown) => {
        this.backupsLoading.set(false);
        this.backupsError.set(apiErrorMessage(error, 'Failed to load the backups'));
      },
    });
  }

  setBackupFor(row: WizardBackup, patch: Partial<Pick<WizardBackup, 'selected' | 'volume'>>): void {
    this.setBackup(this.backups().indexOf(row), patch);
  }

  setBackup(index: number, patch: Partial<Pick<WizardBackup, 'selected' | 'volume'>>): void {
    this.backups.set(this.backups().map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  submit(): void {
    const result = buildOperation(this.form, this.backups());

    if ('error' in result) {
      this.wizardError.set(result.error);

      return;
    }

    this.wizardError.set(null);
    this.facade.createOperation(result.operation);
  }
}
