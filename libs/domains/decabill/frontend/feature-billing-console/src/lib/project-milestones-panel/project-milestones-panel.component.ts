import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, Input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ProjectMilestonesFacade,
  type CreateProjectMilestoneDto,
  type ProjectMilestoneResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcListComponent,
  FpcConfirmDialogComponent,
  FpcListItemComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

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
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
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
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = $localize`:@@featureProjectMilestones-title:Milestones`;
  readonly addTitle = $localize`:@@featureProjectMilestones-add:Add`;

  readonly milestones$ = this.facade.milestones$;
  readonly loading$ = this.facade.loading$;
  readonly saving$ = this.facade.saving$;
  readonly error$ = this.facade.error$;

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

  openTicketsLabel(milestone: ProjectMilestoneResponse): string {
    return $localize`:@@featureProjectMilestones-openTicketCount:${milestone.openTicketCount} open`;
  }

  doneTicketsLabel(milestone: ProjectMilestoneResponse): string {
    return $localize`:@@featureProjectMilestones-doneTicketCount:${milestone.doneTicketCount} done`;
  }

  progressLabel(milestone: ProjectMilestoneResponse): string {
    return $localize`:@@featureProjectMilestones-progress:${milestone.progressPercent}%`;
  }

  progressTextClass(milestone: ProjectMilestoneResponse): string {
    if (milestone.progressPercent === 0) {
      return 'text-danger';
    }

    if (milestone.progressPercent >= 100) {
      return 'text-success';
    }

    return 'text-warning';
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
