import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleBackupsFacade,
  isOpenDeletion,
  type BackupDeletion,
  type BackupDeletionAction,
  ConsoleEndpointService,
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
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { canAdminister, DELETION_STATE_TONE, deletionStateLabel, scopeLabel } from './backup-format';
import { LoadweaverBackupsNavComponent } from './backups-nav.component';

/**
 * Deletion requests (3.20): deleting backups or shortening retention needs a second admin of the scope and takes
 * effect only after the delay. Pending / approved requests with requester, approver and earliest execution; admins
 * approve (not their own request) or cancel; executed and cancelled requests as history.
 */
@Component({
  selector: 'loadweaver-backup-deletions-page',
  imports: [
    FpcPanelGridComponent,
    LoadweaverBackupsNavComponent,
    CommonModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './backup-deletions-page.component.html',
  standalone: true,
})
export class LoadweaverBackupDeletionsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleBackupsFacade);
  private readonly access = inject(ConsoleAccessFacade);

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

  ngOnInit(): void {
    this.facade.loadDeletions();
  }

  refresh(): void {
    this.facade.loadDeletions();
  }

  private project(deletion: BackupDeletion): string | null {
    return deletion.scope === 'cluster' ? null : deletion.scope.replace(/^project-/, '');
  }

  /** Fleet mode: approvals stay native — given in the cluster's own console, never through the fleet's relay. */
  protected readonly fleetMode = inject(ConsoleEndpointService).fleetMode;
  mayAct(deletion: BackupDeletion): boolean {
    return canAdminister(this.me(), this.project(deletion));
  }

  /** The requester can't approve their own request (the API refuses it, too). */
  mayApprove(deletion: BackupDeletion): boolean {
    return (
      !this.fleetMode &&
      deletion.state === 'pending' &&
      this.mayAct(deletion) &&
      deletion.requestedBy !== this.me()?.userId
    );
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
