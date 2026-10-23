import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleVirtualMachinesFacade,
  VmConsoleSocketClient,
  type VmAction,
  type VmSnapshot,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
  FpcStatusBadgeComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';
import { interval, map } from 'rxjs';

import { formatBytes } from '../overview/console-format';
import {
  commandColor,
  commandStatusLabel,
  phaseIcon,
  phaseLabel,
  phaseTone,
  runStrategyLabel,
  snapshotStatusLabel,
  snapshotTone,
  VM_POWER_ACTIONS,
  vmActionConfirmMessage,
  vmActionDangerous,
  vmActionIcon,
  vmActionLabel,
} from './vm-format';
import { LoadweaverVmImportProgressComponent } from './vm-import-progress.component';
import { LoadweaverVmSerialConsoleComponent } from './vm-serial-console.component';
import { LoadweaverVmVncConsoleComponent } from './vm-vnc-console.component';

const REFRESH_MS = 10_000;

export type VmTab = 'overview' | 'serial' | 'vnc';

/**
 * One virtual machine (3.35): status, NICs, disks, snapshots and node commands, the power actions its state and the
 * caller's role allow (each confirmed first; runtime actions, not plans), and its serial and graphical consoles
 * through `socket/consoles`. The spec is edited in the resource editor (YAML → plan).
 */
@Component({
  selector: 'loadweaver-virtual-machine-detail-page',
  imports: [
    LoadweaverVmImportProgressComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
    FpcStatusBadgeComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverVmSerialConsoleComponent,
    LoadweaverVmVncConsoleComponent,
  ],
  providers: [VmConsoleSocketClient],
  templateUrl: './virtual-machine-detail-page.component.html',
  standalone: true,
})
export class LoadweaverVirtualMachineDetailPageComponent implements OnInit {
  private readonly facade = inject(ConsoleVirtualMachinesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly vm = toSignal(this.facade.selected$, { initialValue: null });
  readonly loading = toSignal(this.facade.selectedLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.selectedError$, { initialValue: null });
  readonly acting = toSignal(this.facade.acting$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly snapshots = toSignal(this.facade.snapshots$, { initialValue: [] as VmSnapshot[] });
  readonly snapshotsError = toSignal(this.facade.snapshotsError$, { initialValue: null });
  readonly creatingSnapshot = toSignal(this.facade.creatingSnapshot$, { initialValue: false });

  readonly project = signal<string | null>(null);
  readonly name = signal<string | null>(null);
  readonly tab = signal<VmTab>('overview');
  /** Tabs opened once stay mounted (their console sessions live on in the background). */
  readonly visited = signal<ReadonlySet<VmTab>>(new Set(['overview']));
  readonly pending = signal<VmAction | null>(null);
  readonly snapshotOpen = signal(false);
  snapshotDescription = '';

  readonly powerActions = computed(() => {
    const vm = this.vm();

    return vm ? VM_POWER_ACTIONS.filter((a) => vm.actions.includes(a)) : [];
  });
  readonly canReimage = computed(() => !!this.vm()?.actions.includes('reimage'));
  readonly resourceParams = computed(() => ({ project: this.project() ?? '' }));
  readonly confirmTitle = computed(() => {
    const action = this.pending();

    return action ? `${vmActionLabel(action)}: ${this.name() ?? ''}?` : '';
  });
  readonly confirmMessage = computed(() => {
    const action = this.pending();

    return action ? vmActionConfirmMessage(action) : '';
  });
  readonly confirmLabel = computed(() => {
    const action = this.pending();

    return action ? vmActionLabel(action) : '';
  });
  readonly confirmDanger = computed(() => {
    const action = this.pending();

    return !!action && vmActionDangerous(action);
  });

  readonly phaseTone = phaseTone;
  readonly phaseIcon = phaseIcon;
  readonly phaseLabel = phaseLabel;
  readonly strategyLabel = runStrategyLabel;
  readonly actionLabel = vmActionLabel;
  readonly actionIcon = vmActionIcon;
  readonly dangerous = vmActionDangerous;
  readonly snapshotTone = snapshotTone;
  readonly snapshotStatusLabel = snapshotStatusLabel;
  readonly commandColor = commandColor;
  readonly commandStatusLabel = commandStatusLabel;
  readonly bytes = formatBytes;

  readonly title = $localize`:@@lwConsoleVmDetail-title:Virtual machine`;
  readonly backLabel = $localize`:@@lwConsoleVmDetail-back:All virtual machines`;
  readonly yamlLabel = $localize`:@@lwConsoleVmDetail-yaml:Show YAML`;
  readonly editLabel = $localize`:@@lwConsoleVmDetail-edit:Edit (plan)`;
  readonly refreshLabel = $localize`:@@lwConsoleVmDetail-refresh:Refresh`;
  readonly snapshotLabel = $localize`:@@lwConsoleVmDetail-snapshot:Take snapshot`;
  readonly overviewTab = $localize`:@@lwConsoleVmDetail-overviewTab:Overview`;
  readonly serialTab = $localize`:@@lwConsoleVmDetail-serialTab:Serial console`;
  readonly vncTab = $localize`:@@lwConsoleVmDetail-vncTab:Graphical console`;
  readonly statusTitle = $localize`:@@lwConsoleVmDetail-status:Status`;
  readonly machineTitle = $localize`:@@lwConsoleVmDetail-machine:Machine`;
  readonly nicsTitle = $localize`:@@lwConsoleVmDetail-nics:Network interfaces`;
  readonly disksTitle = $localize`:@@lwConsoleVmDetail-disks:Disks`;
  readonly snapshotsTitle = $localize`:@@lwConsoleVmDetail-snapshots:Snapshots`;
  readonly commandsTitle = $localize`:@@lwConsoleVmDetail-commands:Recent node commands`;
  readonly maintenanceTitle = $localize`:@@lwConsoleVmDetail-maintenance:Maintenance`;
  readonly cancelLabel = $localize`:@@lwConsoleVmDetail-cancel:Cancel`;
  readonly snapshotTitle = $localize`:@@lwConsoleVmDetail-snapshotTitle:Take a snapshot`;

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => [params.get('project'), params.get('name')] as const),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([project, name]) => {
        if (!project || !name) return;

        this.project.set(project);
        this.name.set(name);
        this.facade.open(project, name);
        this.facade.loadSnapshots(project, name);
      });
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      const tab = query.get('tab');

      if (tab === 'serial' || tab === 'vnc' || tab === 'overview') this.selectTab(tab);
    });
    // Power changes and boots take a while: follow the VM while it is shown.
    interval(REFRESH_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload(true));
  }

  reload(silent = false): void {
    const project = this.project();
    const name = this.name();

    if (!project || !name) return;

    this.facade.open(project, name, silent);

    if (!silent || this.snapshots().some((s) => s.status === 'running')) this.facade.loadSnapshots(project, name);
  }

  selectTab(tab: string): void {
    const next = (tab === 'serial' || tab === 'vnc' ? tab : 'overview') as VmTab;

    this.tab.set(next);
    this.visited.update((set) => new Set([...set, next]));
  }

  ask(action: VmAction): void {
    this.facade.clearActionError();
    this.pending.set(action);
  }

  onConfirmOpenChange(open: boolean): void {
    if (!open) this.pending.set(null);
  }

  confirm(): void {
    const action = this.pending();
    const project = this.project();
    const name = this.name();

    if (action && project && name) this.facade.act(project, name, action);

    this.pending.set(null);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }

  openSnapshot(): void {
    this.snapshotDescription = '';
    this.snapshotOpen.set(true);
  }

  takeSnapshot(): void {
    const project = this.project();
    const name = this.name();

    if (project && name) this.facade.snapshot(project, name, this.snapshotDescription.trim() || undefined);

    this.snapshotOpen.set(false);
  }
}
