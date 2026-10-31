import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, Input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ProjectMilestonesFacade,
  ProjectMilestonesService,
  type CreateProjectMilestoneDto,
  type ProjectMilestoneResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  type FpcTableState,
  FpcDatePipe,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { DB_DL_CANCEL, DB_DL_DELETE, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';

type MilestoneEditForm = {
  id: string;
  name: string;
  description: string;
  targetDate: string;
};

@Component({
  selector: 'framework-project-milestones-panel',
  standalone: true,
  imports: [
    FpcDatePipe,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcTableCellDirective,
  ],
  templateUrl: './project-milestones-panel.component.html',
  styleUrls: ['./project-milestones-panel.component.scss'],
})
export class ProjectMilestonesPanelComponent implements OnInit {
  @Input({ required: true }) projectId!: string;
  @Input() isAdmin = false;

  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);

  private readonly facade = inject(ProjectMilestonesFacade);
  private readonly service = inject(ProjectMilestonesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureProjectMilestones-title:Milestones`;
  readonly searchPlaceholder = $localize`:@@featureProjectMilestones-search:Search milestones`;
  readonly addTitle = $localize`:@@featureProjectMilestones-add:Add`;

  readonly milestones$ = this.facade.milestones$;
  readonly loading$ = this.facade.loading$;
  readonly saving$ = this.facade.saving$;
  readonly error$ = this.facade.error$;
  readonly milestones = toSignal(this.facade.milestones$, { initialValue: [] as ProjectMilestoneResponse[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });

  readonly editLabel = $localize`:@@featureProjectMilestones-edit:Edit`;
  readonly lockLabel = $localize`:@@featureProjectMilestones-lock:Lock`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly bulkDeleteTitle = $localize`:@@featureProjectMilestones-bulkDeleteTitle:Delete milestones?`;

  readonly columns: FpcTableColumn<ProjectMilestoneResponse>[] = [
    {
      id: 'state',
      label: $localize`:@@featureProjectMilestones-colState:State`,
      type: 'state',
      state: (milestone) => this.milestoneState(milestone),
    },
    {
      id: 'name',
      label: $localize`:@@featureProjectMilestones-colMilestone:Milestone`,
      value: (milestone) => milestone.name,
      required: true,
      priority: 1,
    },
    {
      id: 'progress',
      label: $localize`:@@featureProjectMilestones-colProgress:Progress`,
      value: (milestone) => milestone.progressPercent,
      align: 'end',
      priority: 1,
    },
    {
      id: 'open',
      label: $localize`:@@featureProjectMilestones-colOpen:Open`,
      value: (milestone) => milestone.openTicketCount,
      align: 'end',
      priority: 2,
    },
    {
      id: 'done',
      label: $localize`:@@featureProjectMilestones-colDone:Done`,
      value: (milestone) => milestone.doneTicketCount,
      align: 'end',
      priority: 2,
    },
    {
      id: 'target',
      label: $localize`:@@featureProjectMilestones-targetDateLabel:Target date`,
      value: (milestone) => milestone.targetDate ?? '',
      priority: 2,
    },
  ];

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  /** Locked milestones can neither be locked again nor deleted. */
  readonly lockableSelection = computed(() => {
    const ids = new Set(this.selected());

    return this.milestones().filter((milestone) => ids.has(milestone.id) && !milestone.lockedAt);
  });
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureProjectMilestones-bulkDeleteMessage:${this.lockableSelection().length}:count: selected milestones will be deleted. This cannot be undone.`,
  );

  readonly rowMenu = (milestone: ProjectMilestoneResponse): FpcMenuItem[] => [
    ...(this.isAdmin && !milestone.lockedAt
      ? [
          { id: 'edit', label: this.editLabel, icon: 'pencil' },
          { id: 'lock', label: this.lockLabel, icon: 'lock' },
          { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
        ]
      : []),
    dbCopyIdItem(),
  ];

  createForm: CreateProjectMilestoneDto = { name: '' };
  editForm: MilestoneEditForm = { id: '', name: '', description: '', targetDate: '' };
  milestoneToDelete: ProjectMilestoneResponse | null = null;

  ngOnInit(): void {
    this.facade.load(this.projectId);
    this.registerModalCloseWatchers();
  }

  openCreateModal(): void {
    if (!this.isAdmin) return;

    this.createForm = { name: '' };
    showBillingModal(this.createModalOpen);
  }

  openEditModal(milestone: ProjectMilestoneResponse): void {
    if (!this.isAdmin || milestone.lockedAt) return;

    this.editForm = {
      id: milestone.id,
      name: milestone.name,
      description: milestone.description ?? '',
      targetDate: this.toDateInputValue(milestone.targetDate),
    };
    showBillingModal(this.editModalOpen);
  }

  openDeleteModal(milestone: ProjectMilestoneResponse): void {
    if (!this.isAdmin || milestone.lockedAt) return;

    this.milestoneToDelete = milestone;
    showBillingModal(this.deleteModalOpen);
  }

  submitCreate(): void {
    if (!this.createForm.name.trim()) return;

    this.facade.create(this.projectId, this.createForm);
  }

  submitEdit(): void {
    if (!this.editForm.name.trim()) return;

    const { id, name, description, targetDate } = this.editForm;

    this.facade.update(this.projectId, id, {
      name: name.trim(),
      description: description.trim() || undefined,
      targetDate: targetDate || null,
    });
  }

  submitDelete(): void {
    if (!this.milestoneToDelete) return;

    this.facade.remove(this.projectId, this.milestoneToDelete.id);
  }

  lockMilestone(id: string): void {
    if (!this.isAdmin) return;

    this.facade.lock(this.projectId, id);
  }

  onRowAction(milestone: ProjectMilestoneResponse, action: string): void {
    if (action === 'edit') this.openEditModal(milestone);
    else if (action === 'lock') this.lockMilestone(milestone.id);
    else if (action === 'delete') this.openDeleteModal(milestone);
    else if (action === 'copy-id') fpcCopyText(milestone.id);
  }

  progressLabel(milestone: ProjectMilestoneResponse): string {
    return $localize`:@@featureProjectMilestones-progress:${milestone.progressPercent}%`;
  }

  targetDateOf(milestone: ProjectMilestoneResponse): string | null {
    return milestone.targetDate ?? null;
  }

  /** Bulk Lock: one `POST …/milestones/:id/lock` per unlocked milestone. */
  async lockSelected(): Promise<void> {
    await this.runBulk((milestone) => firstValueFrom(this.service.lock(this.projectId, milestone.id)));
  }

  /** Bulk Delete: one `DELETE …/milestones/:id` per unlocked milestone. */
  async deleteSelected(): Promise<void> {
    await this.runBulk((milestone) => firstValueFrom(this.service.delete(this.projectId, milestone.id)));
  }

  private async runBulk(run: (milestone: ProjectMilestoneResponse) => Promise<unknown>): Promise<void> {
    const milestones = this.lockableSelection();

    if (!this.isAdmin || milestones.length === 0) return;

    const result = await fpcRunBulk(milestones, run);

    this.bulkResult.set(dbBulkSummary(result, (milestone) => milestone.name));
    this.selected.set([]);
    this.facade.load(this.projectId);
  }

  private milestoneState(milestone: ProjectMilestoneResponse): FpcTableState {
    if (milestone.lockedAt) {
      return { label: this.lockedLabel(), tone: 'neutral', icon: 'lock-fill' };
    }

    if (milestone.progressPercent >= 100) {
      return { label: $localize`:@@featureProjectMilestones-stateCompleted:Completed`, tone: 'success' };
    }

    if (milestone.progressPercent > 0) {
      return {
        label: $localize`:@@featureProjectMilestones-stateInProgress:In progress`,
        tone: 'warning',
        icon: 'hourglass-split',
      };
    }

    return {
      label: $localize`:@@featureProjectMilestones-stateNotStarted:Not started`,
      tone: 'danger',
      icon: 'circle',
    };
  }

  lockedLabel(): string {
    return $localize`:@@featureProjectMilestones-locked:Locked`;
  }

  private toDateInputValue(value: string | null | undefined): string {
    if (!value) return '';

    return value.slice(0, 10);
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = { name: '' };
      },
    });
    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.milestoneToDelete = null;
      },
    });
  }
}
