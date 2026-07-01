import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, Input, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ProjectMilestonesFacade,
  type CreateProjectMilestoneDto,
  type ProjectMilestoneResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './project-milestones-panel.component.html',
  styleUrls: ['./project-milestones-panel.component.scss'],
})
export class ProjectMilestonesPanelComponent implements OnInit {
  @Input({ required: true }) projectId!: string;
  @Input() isAdmin = false;

  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteModal', { static: false }) private deleteModal!: ElementRef<HTMLDivElement>;

  private readonly facade = inject(ProjectMilestonesFacade);
  private readonly destroyRef = inject(DestroyRef);

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
    showBillingModal(this.createModal);
  }

  openEditModal(milestone: ProjectMilestoneResponse): void {
    if (!this.isAdmin || milestone.lockedAt) return;

    this.editForm = {
      id: milestone.id,
      name: milestone.name,
      description: milestone.description ?? '',
      targetDate: this.toDateInputValue(milestone.targetDate),
    };
    showBillingModal(this.editModal);
  }

  openDeleteModal(milestone: ProjectMilestoneResponse): void {
    if (!this.isAdmin || milestone.lockedAt) return;

    this.milestoneToDelete = milestone;
    showBillingModal(this.deleteModal);
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
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = { name: '' };
      },
    });
    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
    });
    watchBillingMutationModalClose({
      loading$: this.saving$,
      error$: this.error$,
      modal: () => this.deleteModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.milestoneToDelete = null;
      },
    });
  }
}
