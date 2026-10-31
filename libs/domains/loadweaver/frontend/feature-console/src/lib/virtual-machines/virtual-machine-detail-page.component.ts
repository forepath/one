import { CommonModule, formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, LOCALE_ID, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleVirtualMachinesFacade,
  VmConsoleSocketClient,
  type VmAction,
  type VmCommand,
  type VmDiskStatus,
  type VmNicStatus,
  type VmSnapshot,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  type FpcBadgeTone,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  type FpcKeyValueItem,
  FpcKeyValueDirective,
  FpcKeyValueListComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcListHeaderComponent,
  type FpcMenuItem,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { interval, map } from 'rxjs';

import { backupStatusLabel } from '../backups/backup-format';
import { formatBytes } from '../overview/console-format';
import { dlCopyIdItem, dlUserLabel } from '../section/data-list';
import {
  commandColor,
  commandStatusLabel,
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
import { LoadweaverLaneComponent } from '../section/lane.component';
import { ResourceModalService } from '../objects/resource-modal.service';

const REFRESH_MS = 10_000;

export type VmTab = 'overview' | 'serial' | 'vnc';

/** What the VM part shows: everything (standalone) or one object page tab (3.37). */
export type VmDetailPart = 'all' | 'summary' | 'console' | 'hardware' | 'snapshots';

/** Lanes of the VM detail parts (3.37). */
export type VmDetailLane = 'status' | 'commands' | 'nics' | 'disks' | 'snapshots';

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
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcKeyValueDirective,
    FpcKeyValueListComponent,
    FpcDataTableComponent,
    FpcListHeaderComponent,
    FpcTableCellDirective,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverVmSerialConsoleComponent,
    LoadweaverVmVncConsoleComponent,
    FpcSectionRowComponent,
    LoadweaverLaneComponent,
  ],
  providers: [VmConsoleSocketClient],
  // Fills its routed outlet / object page tab: the lanes scroll, not the page (3.37).
  host: { class: 'd-flex flex-column flex-grow-1 min-h-0' },
  templateUrl: './virtual-machine-detail-page.component.html',
  standalone: true,
})
export class LoadweaverVirtualMachineDetailPageComponent implements OnInit {
  /** The object page tab this part renders; `all` = the full page with its own header. */
  readonly part = input<VmDetailPart>('all');
  private readonly facade = inject(ConsoleVirtualMachinesFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly locale = inject(LOCALE_ID);
  private readonly resourceModal = inject(ResourceModalService);

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

  readonly phaseLabel = phaseLabel;
  readonly strategyLabel = runStrategyLabel;
  readonly actionLabel = vmActionLabel;
  readonly actionIcon = vmActionIcon;
  readonly dangerous = vmActionDangerous;
  readonly snapshotStatusLabel = snapshotStatusLabel;
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
  readonly backupStatus = backupStatusLabel;
  readonly nameId = (row: { name: string }) => row.name;
  readonly copyIdMenu = (): FpcMenuItem[] => [dlCopyIdItem()];

  /** 3.38 D1: State (command status) · action · node · requested by · time · error. */
  readonly commandColumns: FpcTableColumn<VmCommand>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleVmDetail-colStatus:Status`,
      type: 'state',
      state: (c) => ({ label: commandStatusLabel(c.status), tone: this.commandTone(c.status) }),
    },
    {
      id: 'action',
      label: $localize`:@@lwConsoleVmDetail-colAction:Command`,
      value: (c) => vmCommandActionLabel(c.action),
      required: true,
      priority: 1,
    },
    { id: 'node', label: $localize`:@@lwConsoleVmDetail-colNode:Node`, value: (c) => c.node },
    {
      id: 'requestedBy',
      label: $localize`:@@lwConsoleVmDetail-colRequestedBy:Requested by`,
      value: (c) => dlUserLabel(c.requestedBy, c.requestedByEmail),
      priority: 3,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleVmDetail-colCreated:Created`,
      value: (c) => c.createdAt,
      priority: 1,
    },
    { id: 'error', label: $localize`:@@lwConsoleVmDetail-colError:Error`, value: (c) => c.error ?? '' },
  ];
  /** 3.38 D1: name (primary) · addresses · MAC · groups · labels. */
  readonly nicColumns: FpcTableColumn<VmNicStatus>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleVmDetail-colName:Name`,
      value: (n) => n.name,
      required: true,
      priority: 1,
    },
    {
      id: 'addresses',
      label: $localize`:@@lwConsoleVmDetail-colAddresses:Addresses`,
      value: (n) => n.addresses.join(', ') || n.families.join(' + '),
      mono: true,
      priority: 1,
    },
    { id: 'mac', label: $localize`:@@lwConsoleVmDetail-colMac:MAC`, value: (n) => n.mac, mono: true },
    { id: 'groups', label: $localize`:@@lwConsoleVmDetail-colGroups:Groups` },
    {
      id: 'labels',
      label: $localize`:@@lwConsoleVmDetail-colLabels:Labels`,
      value: (n) =>
        Object.entries(n.labels)
          .map(([key, value]) => `${key}=${value}`)
          .join(', '),
      mono: true,
      priority: 3,
    },
  ];
  /** 3.38 D1: name (boot / not placed) · size · volume · bus · cache · primary / copies / remote. */
  readonly diskColumns: FpcTableColumn<VmDiskStatus>[] = [
    {
      id: 'name',
      label: $localize`:@@lwConsoleVmDetail-colName:Name`,
      value: (d) => d.name,
      required: true,
      priority: 1,
    },
    {
      id: 'size',
      label: $localize`:@@lwConsoleVmDetail-colSize:Size`,
      value: (d) => d.sizeBytes,
      align: 'end',
      priority: 1,
    },
    { id: 'volume', label: $localize`:@@lwConsoleVmDetail-colVolume:Volume`, value: (d) => d.volume, mono: true },
    { id: 'bus', label: $localize`:@@lwConsoleVmDetail-colBus:Bus`, value: (d) => d.bus, priority: 3 },
    { id: 'cache', label: $localize`:@@lwConsoleVmDetail-colCache:Cache`, value: (d) => d.cache, priority: 3 },
    {
      id: 'primaryNode',
      label: $localize`:@@lwConsoleVmDetail-primaryOn:Primary on`,
      value: (d) => d.primaryNode ?? '',
    },
    {
      id: 'copies',
      label: $localize`:@@lwConsoleVmDetail-colCopies:Copies`,
      value: (d) => d.syncReplicas.join(', '),
      priority: 3,
    },
    {
      id: 'remote',
      label: $localize`:@@lwConsoleVmDetail-colRemote:Remote copies`,
      value: (d) => d.remoteReplicas.join(', '),
      priority: 3,
    },
  ];
  /** 3.38 D1: State · taken · consistency · description · disks (their backups). */
  readonly snapshotColumns: FpcTableColumn<VmSnapshot>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleVmDetail-colStatus:Status`,
      type: 'state',
      state: (s) => ({ label: snapshotStatusLabel(s.status), tone: this.snapshotTone(s.status) }),
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleVmDetail-colTaken:Taken`,
      value: (s) => s.createdAt,
      required: true,
      priority: 1,
    },
    {
      id: 'consistency',
      label: $localize`:@@lwConsoleVmDetail-colConsistency:Consistency`,
      value: (s) =>
        s.consistency === 'application'
          ? $localize`:@@lwConsoleVmDetail-appConsistent:Application-consistent`
          : $localize`:@@lwConsoleVmDetail-crashConsistent:Crash-consistent`,
      priority: 1,
    },
    {
      id: 'description',
      label: $localize`:@@lwConsoleVmDetail-colDescription:Description`,
      value: (s) => s.description ?? '',
    },
    { id: 'disks', label: $localize`:@@lwConsoleVmDetail-colDisks:Disks`, priority: 3 },
  ];
  readonly cancelLabel = $localize`:@@lwConsoleVmDetail-cancel:Cancel`;
  readonly consoleSwitchLabel = $localize`:@@lwConsoleVmDetail-consoleSwitch:Console`;
  readonly loadingLabel = $localize`:@@lwConsoleVmDetail-loading:Loading the virtual machine`;

  /** Status facts (3.38: the former header strip folds in here; the object header names the VM). */
  readonly statusFacts = computed<FpcKeyValueItem[]>(() => {
    const v = this.vm();

    if (!v) return [];

    const st = v.status;
    const power = v.powerDetail.changedAt
      ? `${v.power} (${[dlUserLabel(v.powerDetail.changedBy, v.powerDetail.changedByEmail), this.date(v.powerDetail.changedAt, 'short')].filter(Boolean).join(', ')})`
      : v.power;
    const report = st.reportedAt ? `${st.state ?? '–'} (${this.date(st.reportedAt, 'short')})` : st.state;

    return [
      { key: 'phase', label: $localize`:@@lwConsoleVmDetail-phase:Phase` },
      {
        key: 'strategy',
        label: $localize`:@@lwConsoleVmDetail-runStrategy:Run strategy`,
        value: runStrategyLabel(v.runStrategy),
      },
      ...(v.description
        ? [{ key: 'description', label: $localize`:@@lwConsoleVmDetail-description:Description`, value: v.description }]
        : []),
      { key: 'node', label: $localize`:@@lwConsoleVmDetail-node:Node`, value: st.node },
      ...(st.migration
        ? [
            {
              key: 'migration',
              label: $localize`:@@lwConsoleVmDetail-migratingTo:Migrating to`,
              value: st.migration.targetNode,
            },
          ]
        : []),
      ...(st.importProgress
        ? [{ key: 'import', label: $localize`:@@lwConsoleVmDetail-bootDiskImport:Boot disk` }]
        : []),
      ...(st.guestPower
        ? [{ key: 'guest', label: $localize`:@@lwConsoleVmDetail-guestPower:Guest`, value: st.guestPower }]
        : []),
      { key: 'report', label: $localize`:@@lwConsoleVmDetail-reported:Node report`, value: report },
      ...(st.message
        ? [{ key: 'message', label: $localize`:@@lwConsoleVmDetail-message:Message`, value: st.message }]
        : []),
      {
        key: 'lastBoot',
        label: $localize`:@@lwConsoleVmDetail-lastBoot:Running since`,
        value: this.date(st.lastBoot, 'medium'),
      },
      { key: 'power', label: $localize`:@@lwConsoleVmDetail-power:Power`, value: power },
      { key: 'labels', label: $localize`:@@lwConsoleVmDetail-labels:Labels` },
    ];
  });
  readonly machineFacts = computed<FpcKeyValueItem[]>(() => {
    const v = this.vm();

    if (!v) return [];

    return [
      { key: 'image', label: $localize`:@@lwConsoleVmDetail-image:Image`, value: v.image, mono: true },
      { key: 'pinned', label: $localize`:@@lwConsoleVmDetail-pinned:Pinned`, value: v.pinnedImage, mono: true },
      { key: 'cpu', label: $localize`:@@lwConsoleVmDetail-cpu:CPU`, value: `${v.vcpus} ${this.vcpusLabel}` },
      { key: 'memory', label: $localize`:@@lwConsoleVmDetail-memory:Memory`, value: formatBytes(v.memoryBytes) },
      { key: 'storage', label: $localize`:@@lwConsoleVmDetail-storage:Storage`, value: formatBytes(v.diskBytes) },
      {
        key: 'cloudInit',
        label: $localize`:@@lwConsoleVmDetail-cloudInit:cloud-init generation`,
        value: v.powerDetail.instanceGeneration,
      },
    ];
  });
  private readonly vcpusLabel = $localize`:@@lwConsoleVmDetail-vcpus:vCPUs`;
  readonly snapshotTitle = $localize`:@@lwConsoleVmDetail-snapshotTitle:Take a snapshot`;

  /** Phone lane switch (3.37): the lanes of the shown part, one at a time below md. */
  readonly lane = signal<VmDetailLane>('status');
  readonly laneTabs = computed<{ id: VmDetailLane; label: string }[]>(() => {
    const part = this.part();
    const all = part === 'all';

    return [
      ...(all || part === 'summary'
        ? [
            { id: 'status' as const, label: this.statusTitle },
            { id: 'commands' as const, label: this.commandsTitle },
          ]
        : []),
      ...(all || part === 'hardware'
        ? [
            { id: 'nics' as const, label: this.nicsTitle },
            { id: 'disks' as const, label: this.disksTitle },
          ]
        : []),
      ...(all || part === 'snapshots' ? [{ id: 'snapshots' as const, label: this.snapshotsTitle }] : []),
    ];
  });
  /** The picked lane when the part shows it, else its first lane. */
  readonly activeLane = computed<VmDetailLane | null>(() => {
    const tabs = this.laneTabs();

    return tabs.some((t) => t.id === this.lane()) ? this.lane() : (tabs[0]?.id ?? null);
  });

  /** Object state as a tone badge (3.38 R10; status circles are for health only). */
  phaseBadgeTone(phase: Parameters<typeof phaseTone>[0]): FpcBadgeTone {
    return badgeTone(phaseTone(phase));
  }

  snapshotTone(status: VmSnapshot['status']): FpcBadgeTone {
    return badgeTone(snapshotTone(status));
  }

  commandTone(status: Parameters<typeof commandColor>[0]): FpcBadgeTone {
    return badgeTone(commandColor(status));
  }

  /** "Edit": the VM resource in the edit modal (changes go into the draft). */
  edit(): void {
    const name = this.name();

    if (name) this.resourceModal.openEdit({ kind: 'VirtualMachine', name, project: this.project() ?? null });
  }

  copyId(id: string): void {
    fpcCopyText(id);
  }

  private date(value: string | null | undefined, format: string): string | null {
    return value ? formatDate(value, format, this.locale) : null;
  }

  /** Whether a panel group belongs to the shown part (object page tabs, 3.37). */
  shows(panel: Exclude<VmDetailPart, 'all' | 'console'>): boolean {
    const part = this.part();

    return part === 'all' || part === panel;
  }

  ngOnInit(): void {
    // The Console tab of the object page opens the serial console (or the graphical one with `?console=vnc`).
    if (this.part() === 'console')
      this.selectTab(this.route.snapshot.queryParamMap.get('console') === 'vnc' ? 'vnc' : 'serial');

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

      if (this.part() === 'all' && (tab === 'serial' || tab === 'vnc' || tab === 'overview')) this.selectTab(tab);
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

  selectTab(tab: string | null): void {
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

/** Status-badge / colour tones → `fpc-badge` tones (`secondary` reads as neutral). */
/** A node command's action, readable (3.38 D9; `destroy` is the force-off; unknown actions as they are). */
export function vmCommandActionLabel(action: string): string {
  if (action === 'destroy') return vmActionLabel('force-off');

  return (['start', 'stop', 'force-off', 'shutdown', 'reboot', 'reset', 'reimage'] as string[]).includes(action)
    ? vmActionLabel(action as VmAction)
    : action;
}

function badgeTone(tone: string): FpcBadgeTone {
  return tone === 'success' || tone === 'warning' || tone === 'danger' || tone === 'info' || tone === 'primary'
    ? tone
    : 'neutral';
}
