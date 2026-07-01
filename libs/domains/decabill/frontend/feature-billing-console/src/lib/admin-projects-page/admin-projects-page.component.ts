import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  AdminProjectsService,
  ProjectsFacade,
  type AdminProjectListItem,
  type CreateAdminProjectDto,
  type UpdateAdminProjectDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import { combineLatestWith, map } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import {
  formatProjectHourlyRate,
  formatProjectMinutes,
  formatProjectOpenBillableAmount,
  getProjectStatusIconClass,
  getProjectStatusLabel,
  getProjectStatusTextClass,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

@Component({
  selector: 'framework-admin-projects-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, BillingAdminUserSelectComponent],
  providers: [DecimalPipe],
  templateUrl: './admin-projects-page.component.html',
  styleUrls: ['./admin-projects-page.component.scss'],
})
export class AdminProjectsPageComponent implements OnInit {
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteModal', { static: false }) private deleteModal!: ElementRef<HTMLDivElement>;
  @ViewChild('createUserSelect') private createUserSelect?: BillingAdminUserSelectComponent;

  private readonly facade = inject(ProjectsFacade);
  private readonly adminService = inject(AdminProjectsService);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly projectsRoute = inject(ActivatedRoute);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly projects$ = this.facade.adminProjects$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([projects, q]) => {
      const term = q.trim().toLowerCase();

      if (!term) return projects;

      return projects.filter((p) => JSON.stringify(p).toLowerCase().includes(term));
    }),
  );

  readonly loading$ = this.facade.loading$;
  readonly creating$ = this.facade.creating$;
  readonly updating$ = this.facade.updating$;
  readonly deleting$ = this.facade.deleting$;
  readonly error$ = this.facade.error$;

  readonly projects = toSignal(this.projects$, { initialValue: [] as AdminProjectListItem[] });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });

  readonly usersWithoutProject = computed(() => this.users());

  createForm: CreateAdminProjectDto = this.emptyCreateForm();
  editForm: UpdateAdminProjectDto & { id: string } = { id: '', name: '', hourlyRateNet: 0 };
  projectToDelete: AdminProjectListItem | null = null;

  ngOnInit(): void {
    this.facade.loadAdminProjects();
    this.authFacade.loadUsers();
    this.registerModalCloseWatchers();
  }

  openCreateModal(): void {
    this.createForm = this.emptyCreateForm();
    showBillingModal(this.createModal);
    queueMicrotask(() => this.createUserSelect?.reset());
  }

  openEditModal(project: AdminProjectListItem): void {
    this.adminService.getById(project.id).subscribe({
      next: (full) => {
        this.editForm = {
          id: full.id,
          name: full.name,
          description: full.description ?? '',
          status: full.status,
          hourlyRateNet: full.hourlyRateNet,
          currency: full.currency,
        };
        showBillingModal(this.editModal);
      },
    });
  }

  openDeleteModal(project: AdminProjectListItem): void {
    this.projectToDelete = project;
    showBillingModal(this.deleteModal);
  }

  submitCreate(): void {
    if (!this.createForm.userId || !this.createForm.name.trim()) return;

    this.facade.createAdminProject(this.createForm);
  }

  submitEdit(): void {
    const { id, ...dto } = this.editForm;

    this.facade.updateAdminProject(id, dto);
  }

  submitDelete(): void {
    if (!this.projectToDelete) return;

    this.facade.deleteAdminProject(this.projectToDelete.id);
  }

  projectStatusLabel(status: string): string {
    return getProjectStatusLabel(status);
  }

  projectStatusTextClass(status: string): string {
    return getProjectStatusTextClass(status);
  }

  projectStatusIconClass(status: string): string {
    return getProjectStatusIconClass(status);
  }

  hourlyRateLabel(amount: number, currency: string): string {
    return formatProjectHourlyRate(amount, currency);
  }

  unbilledTimeLabel(minutes: number): string {
    return formatProjectMinutes(minutes);
  }

  openBillableLabel(amount: number, currency: string): string {
    return formatProjectOpenBillableAmount(amount, currency);
  }

  private emptyCreateForm(): CreateAdminProjectDto {
    return { userId: '', name: '', hourlyRateNet: 100, currency: 'EUR' };
  }

  private registerModalCloseWatchers(): void {
    const reload = (): void => this.facade.loadAdminProjects();

    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.emptyCreateForm();
        reload();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: reload,
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      modal: () => this.deleteModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.projectToDelete = null;
        reload();
      },
    });
  }
}
