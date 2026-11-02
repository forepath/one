import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  isOpenDeletion,
  type BackupDeletion,
  type BackupDeletionAction,
  BackupsService,
  type BackupVolume,
  ConsoleEndpointService,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { canAdminister, DELETION_STATE_TONE, deletionStateLabel, scopeLabel } from './backup-format';
import { approvalsAvailable } from '../access/access-format';
import { filterBySearch } from '../list-search';
import { dlBulkSummary, dlCopyIdItem, dlUserLabel } from '../section/data-list';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/**
 * Deletion requests (3.20): deleting backups or shortening retention needs a second admin of the scope and takes
 * effect only after the delay. Pending / approved requests with requester, approver and earliest execution; admins
 * approve (not their own request) or cancel; executed and cancelled requests as history.
 */
/** What the deletion lanes' searches look at. */
function deletionSearchFields(d: BackupDeletion): (string | string[] | null)[] {
  return [
    d.reason,
    dlUserLabel(d.requestedBy, d.requestedByEmail),
    dlUserLabel(d.approvedBy, d.approvedByEmail),
    d.requestedBy,
    d.approvedBy,
    scopeLabel(d.scope),
    deletionStateLabel(d.state),
    d.retention?.policy ?? null,
  ];
}

@Component({
  selector: 'loadweaver-backup-deletions-page',
  imports: [
    LoadweaverSavedViewsComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
  ],
  templateUrl: './backup-deletions-page.component.html',
  standalone: true,
})
export class LoadweaverBackupDeletionsPageComponent implements OnInit {
  /** Requester / approver label (email, "Deleted user", …), never the raw id (D11). */
  readonly userLabel = dlUserLabel;
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly service = inject(BackupsService);

  readonly deletions = toSignal(this.facade.deletions$, { initialValue: null as BackupDeletion[] | null });
  readonly loading = toSignal(this.facade.deletionsLoading$, { initialValue: false });
  readonly error = toSignal(this.facade.deletionsError$, { initialValue: null });
  readonly acting = toSignal(this.facade.deletionActing$, { initialValue: null });
  readonly actionError = toSignal(this.facade.deletionActionError$, { initialValue: null });
  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly isClusterAdmin = toSignal(this.access.isClusterAdmin$, { initialValue: false });
  readonly hasClusterRole = toSignal(this.access.seesInfrastructure$, { initialValue: false });

  readonly open = computed(() => (this.deletions() ?? []).filter(isOpenDeletion));
  readonly history = computed(() => (this.deletions() ?? []).filter((d) => !isOpenDeletion(d)));
  /** Lane searches (3.37 lane grammar) and the phone lane switch. */
  readonly openSearch = signal('');
  readonly historySearch = signal('');
  readonly lane = signal<'open' | 'history'>('open');
  readonly openShown = computed(() => filterBySearch(this.open(), this.openSearch(), deletionSearchFields));
  readonly historyShown = computed(() => filterBySearch(this.history(), this.historySearch(), deletionSearchFields));
  /** "Views ▾" (3.37): saved lane searches, per user. */
  readonly views = savedViewBinding({ openSearch: this.openSearch, historySearch: this.historySearch });
  readonly searchLabel = $localize`:@@lwConsoleBackupDeletions-search:Search requests`;
  readonly loadingLabel = $localize`:@@lwConsoleBackupDeletions-loading:Loading deletion requests`;
  readonly noHistoryLabel = $localize`:@@lwConsoleBackupDeletions-noHistory:No decided requests yet`;
  readonly confirm = signal<{ deletion: BackupDeletion; action: BackupDeletionAction } | null>(null);

  readonly tone = DELETION_STATE_TONE;
  readonly stateLabel = deletionStateLabel;
  readonly scope = scopeLabel;

  readonly title = $localize`:@@lwConsoleBackupDeletions-title:Deletion requests`;
  readonly refreshLabel = $localize`:@@lwConsoleBackupDeletions-refresh:Refresh`;
  readonly openTitle = $localize`:@@lwConsoleBackupDeletions-open:Open requests`;
  readonly historyTitle = $localize`:@@lwConsoleBackupDeletions-history:History`;
  readonly approveLabel = $localize`:@@lwConsoleBackupDeletions-approve:Approve`;
  readonly cancelLabel = $localize`:@@lwConsoleBackupDeletions-cancel:Cancel request`;
  readonly keepLabel = $localize`:@@lwConsoleBackupDeletions-keep:Keep`;
  readonly approveTitle = $localize`:@@lwConsoleBackupDeletions-approveTitle:Approve the deletion?`;
  readonly approveMessage = $localize`:@@lwConsoleBackupDeletions-approveMessage:The backups are deleted for good once the delay has passed (object locks still apply). Any admin can cancel the request until then.`;
  readonly cancelTitle = $localize`:@@lwConsoleBackupDeletions-cancelTitle:Cancel the deletion request?`;
  readonly cancelMessage = $localize`:@@lwConsoleBackupDeletions-cancelMessage:The backups are kept; deleting them needs a new request.`;
  readonly ownLabel = $localize`:@@lwConsoleBackupDeletions-own:Another admin approves`;
  readonly backupsOfLabel = $localize`:@@lwConsoleBackupDeletions-backupsOfRequest:Backups of the request`;

  /** The catalog (if loaded): backup id → volume + time, so the request names its backups without ids (D11). */
  private readonly volumes = toSignal(this.facade.volumes$, { initialValue: [] as BackupVolume[] });
  private readonly backupNames = computed(
    () =>
      new Map(
        this.volumes().flatMap((v) =>
          v.backups.map((b) => [b.id, `${b.resource} · ${new Date(b.startedAt).toLocaleString()}`] as const),
        ),
      ),
  );
  /** A backup of a request: volume + time from the catalog, else "Backup n". */
  backupName(id: string, index: number): string {
    return this.backupNames().get(id) ?? $localize`:@@lwConsoleBackupDeletions-backupN:Backup ${index + 1}:index:`;
  }

  /** What the request deletes, for people: "Shorter retention of policy x" or "n backups". */
  requestLabel(d: BackupDeletion): string {
    const policy = d.retention?.policy ?? '';

    return d.kind === 'retention'
      ? $localize`:@@lwConsoleBackupDeletions-retentionOf:Shorter retention of policy ${policy}:policy:`
      : $localize`:@@lwConsoleBackupDeletions-backupCount:${d.backupIds.length}:count: backups`;
  }

  private readonly baseColumns: FpcTableColumn<BackupDeletion>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleBackupDeletions-colState:State`,
      type: 'state',
      state: (d) => ({ label: deletionStateLabel(d.state), tone: DELETION_STATE_TONE[d.state] }),
    },
    {
      id: 'request',
      label: $localize`:@@lwConsoleBackupDeletions-colRequest:Request`,
      value: (d) => this.requestLabel(d),
      required: true,
      priority: 1,
    },
    {
      id: 'scope',
      label: $localize`:@@lwConsoleBackupDeletions-colScope:Scope`,
      value: (d) => scopeLabel(d.scope),
      priority: 2,
    },
    {
      id: 'reason',
      label: $localize`:@@lwConsoleBackupDeletions-colReason:Reason`,
      value: (d) => d.reason,
      priority: 1,
    },
    {
      id: 'requestedBy',
      label: $localize`:@@lwConsoleBackupDeletions-requestedBy:Requested by`,
      value: (d) => dlUserLabel(d.requestedBy, d.requestedByEmail),
      priority: 2,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleBackupDeletions-colCreated:Requested`,
      value: (d) => d.createdAt,
      priority: 2,
    },
    {
      id: 'approvedBy',
      label: $localize`:@@lwConsoleBackupDeletions-colApprovedBy:Approved by`,
      value: (d) => dlUserLabel(d.approvedBy, d.approvedByEmail),
      priority: 3,
    },
  ];
  /** Open: … · takes effect at the earliest. */
  readonly openColumns: FpcTableColumn<BackupDeletion>[] = [
    ...this.baseColumns,
    {
      id: 'notBefore',
      label: $localize`:@@lwConsoleBackupDeletions-notBefore:Takes effect at the earliest`,
      value: (d) => d.notBefore,
      priority: 2,
    },
  ];
  /** History: … · executed. */
  readonly historyColumns: FpcTableColumn<BackupDeletion>[] = [
    ...this.baseColumns,
    {
      id: 'executed',
      label: $localize`:@@lwConsoleBackupDeletions-colExecuted:Executed`,
      value: (d) => d.executedAt,
      priority: 2,
    },
  ];

  readonly expanded = signal<string | null>(null);
  readonly selected = signal<readonly string[]>([]);
  readonly bulkConfirm = signal<BackupDeletionAction | null>(null);
  readonly bulkResult = signal<{ tone: 'success' | 'warning' | 'danger'; message: string } | null>(null);
  private readonly selectedRequests = computed(() => {
    const ids = new Set(this.selected());

    return this.open().filter((d) => ids.has(d.id));
  });
  readonly canCancelSelection = computed(
    () => this.selectedRequests().length > 0 && this.selectedRequests().every((d) => this.mayAct(d)),
  );
  readonly canApproveSelection = computed(
    () => this.selectedRequests().length > 0 && this.selectedRequests().every((d) => this.mayApprove(d)),
  );
  readonly bulkMessage = computed(() =>
    this.bulkConfirm() === 'approve'
      ? $localize`:@@lwConsoleBackupDeletions-bulkApproveMessage:${this.selectedRequests().length}:count: requests are approved; their backups are deleted for good once the delay has passed. Requests you may not approve are reported and left as they are.`
      : $localize`:@@lwConsoleBackupDeletions-bulkCancelMessage:${this.selectedRequests().length}:count: requests are cancelled; their backups are kept. Requests you may not cancel are reported and left as they are.`,
  );

  readonly menu = (d: BackupDeletion): FpcMenuItem[] => [
    ...(this.mayAct(d) && isOpenDeletion(d)
      ? [{ id: 'cancel', label: this.cancelLabel, icon: 'x-circle', disabled: this.acting() !== null }]
      : []),
    ...(this.mayApprove(d)
      ? [
          {
            id: 'approve',
            label: this.approveLabel,
            icon: 'check2-circle',
            danger: true,
            disabled: this.acting() !== null,
          },
        ]
      : []),
    { ...dlCopyIdItem(), dividerBefore: this.mayAct(d) && isOpenDeletion(d) },
  ];

  ngOnInit(): void {
    this.facade.loadDeletions();
  }

  refresh(): void {
    this.facade.loadDeletions();
  }

  private project(deletion: BackupDeletion): string | null {
    return deletion.scope === 'cluster' ? null : deletion.scope.replace(/^project-/, '');
  }

  /** Fleet mode: approvals through the fleet only when the cluster verifies its identity claims (3.24). */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  mayAct(deletion: BackupDeletion): boolean {
    return canAdminister(this.me(), this.project(deletion));
  }

  /** The requester can't approve their own request (the API refuses it, too). */
  mayApprove(deletion: BackupDeletion): boolean {
    return (
      approvalsAvailable(this.fleetMode, this.me()) &&
      deletion.state === 'pending' &&
      this.mayAct(deletion) &&
      deletion.requestedBy !== this.me()?.userId
    );
  }

  toggle(deletion: BackupDeletion): void {
    this.expanded.update((id) => (id === deletion.id ? null : deletion.id));
  }

  onRowAction(deletion: BackupDeletion, action: string): void {
    if (action === 'cancel' || action === 'approve') this.ask(deletion, action);
    else if (action === 'copy-id') fpcCopyText(deletion.id);
  }

  /** Bulk Cancel / Approve: one call per request (same endpoint + authorization as the row action). */
  async runBulk(): Promise<void> {
    const action = this.bulkConfirm();

    this.bulkConfirm.set(null);

    if (!action) return;

    const requests = this.selectedRequests().filter((d) =>
      action === 'approve' ? this.mayApprove(d) : this.mayAct(d),
    );

    if (requests.length === 0) return;

    const result = await fpcRunBulk(requests, (d) => firstValueFrom(this.service.actOnDeletion(d.id, action)));

    this.bulkResult.set(dlBulkSummary(result, (d) => `${this.requestLabel(d)} (${d.reason})`));
    this.selected.set([]);
    this.facade.loadDeletions();
  }

  onBulkConfirmOpenChange(open: boolean): void {
    if (!open) this.bulkConfirm.set(null);
  }

  ask(deletion: BackupDeletion, action: BackupDeletionAction): void {
    this.facade.clearDeletionActionError();
    this.confirm.set({ deletion, action });
  }

  onConfirmOpenChange(open: boolean): void {
    if (!open) this.confirm.set(null);
  }

  confirmed(): void {
    const confirm = this.confirm();

    if (confirm) this.facade.actOnDeletion(confirm.deletion.id, confirm.action);

    this.confirm.set(null);
  }

  /** Still waiting for the delay. */
  waiting(deletion: BackupDeletion): boolean {
    return new Date(deletion.notBefore).getTime() > Date.now();
  }
}
