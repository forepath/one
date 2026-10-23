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
  FpcCollapsibleFilterPanelComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormCheckComponent,
  FpcFormCheckGroupComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcProgressComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, interval, switchMap, take } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import {
  FLEET_OPERATION_TONE,
  fleetCurrentStep,
  fleetOperationActive,
  fleetOperationKindLabel,
  fleetOperationProgress,
  fleetOperationStatusLabel,
  fleetStepTone,
} from './fleet-format';

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
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcCollapsibleFilterPanelComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormCheckComponent,
    FpcFormCheckGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcProgressComponent,
    FpcSpinnerComponent,
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

  readonly title = $localize`:@@lwConsoleFleetOps-title:Fleet operations`;
  readonly newLabel = $localize`:@@lwConsoleFleetOps-new:Restore or clone across clusters`;
  readonly refreshLabel = $localize`:@@lwConsoleFleetOps-refresh:Refresh`;
  readonly filtersLabel = $localize`:@@lwConsoleFleetOps-filters:Filters`;
  readonly wizardTitle = $localize`:@@lwConsoleFleetOps-wizardTitle:Cross-cluster restore / clone`;
  readonly cancelTitle = $localize`:@@lwConsoleFleetOps-cancelTitle:Cancel the operation?`;
  readonly cancelMessage = $localize`:@@lwConsoleFleetOps-cancelMessage:The fleet stops it. Imports and plans the clusters already created stay visible there.`;
  readonly cancelConfirm = $localize`:@@lwConsoleFleetOps-cancelConfirm:Cancel operation`;
  readonly keepLabel = $localize`:@@lwConsoleFleetOps-keep:Keep running`;
  readonly closeLabel = $localize`:@@lwConsoleFleetOps-close:Close`;

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

  onClusterFilter(value: string): void {
    this.clusterFilter.set(value ?? '');
    this.refresh();
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
