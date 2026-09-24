import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
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
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcInfiniteScrollDirective,
  FpcListAppendFooterComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import {
  formatProjectHourlyRate,
  formatProjectMinutes,
  formatProjectOpenBillableAmount,
  getProjectStatusIconClass,
  getProjectStatusLabel,
  getProjectStatusTextClass,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

@Component({
  selector: 'framework-admin-projects-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    BillingAdminUserSelectComponent,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcFormControlComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcFormFieldComponent,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcInfiniteScrollDirective,
    FpcListAppendFooterComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  providers: [DecimalPipe],
  templateUrl: './admin-projects-page.component.html',
  styleUrls: ['./admin-projects-page.component.scss'],
})
export class AdminProjectsPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  @ViewChild('createUserSelect') private createUserSelect?: BillingAdminUserSelectComponent;

  readonly pageTitle = $localize`:@@featureAdminProjects-title:Projects`;
  readonly addProjectAriaLabel = $localize`:@@featureAdminProjects-add:Add`;
  readonly searchPlaceholder = $localize`:@@featureAdminProjects-searchPlaceholder:Search projects`;

  readonly facade = inject(ProjectsFacade);
  private readonly adminService = inject(AdminProjectsService);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly projectsRoute = inject(ActivatedRoute);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);

  readonly loading$ = this.facade.loading$;
  readonly creating$ = this.facade.creating$;
  readonly updating$ = this.facade.updating$;
  readonly deleting$ = this.facade.deleting$;
  readonly error$ = this.facade.error$;
  readonly hasMore$ = this.facade.adminHasMore$;
  readonly appendLoading$ = this.facade.adminAppendLoading$;
  readonly appendError$ = this.facade.adminAppendError$;

  readonly projects = toSignal(this.facade.adminProjects$, { initialValue: [] as AdminProjectListItem[] });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });

  readonly usersWithoutProject = computed(() => this.users());

  createForm: CreateAdminProjectDto = this.emptyCreateForm();
  editForm: UpdateAdminProjectDto & { id: string } = { id: '', name: '', hourlyRateNet: 0 };
  editTargetHoursInput: number | null = null;
  createTargetHoursInput: number | null = null;
  projectToDelete: AdminProjectListItem | null = null;

  ngOnInit(): void {
    this.facade.loadAdminProjects();
    this.authFacade.loadUsers();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadAdminProjects({ search: search.trim() || undefined });
      });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
  }

  openCreateModal(): void {
    this.createForm = this.emptyCreateForm();
    this.createTargetHoursInput = null;
    showBillingModal(this.createModalOpen);
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
        this.editTargetHoursInput = full.targetHours ?? null;
        showBillingModal(this.editModalOpen);
      },
    });
  }

  openDeleteModal(project: AdminProjectListItem): void {
    this.projectToDelete = project;
    showBillingModal(this.deleteModalOpen);
  }

  submitCreate(): void {
    if (!this.createForm.userId || !this.createForm.name.trim()) return;

    const payload: CreateAdminProjectDto = { ...this.createForm };
    const targetHours = this.normalizeTargetHoursInput(this.createTargetHoursInput);

    if (targetHours != null) {
      payload.targetHours = targetHours;
    }

    this.facade.createAdminProject(payload);
  }

  submitEdit(): void {
    const { id, ...dto } = this.editForm;

    this.facade.updateAdminProject(id, {
      ...dto,
      targetHours: this.normalizeTargetHoursInput(this.editTargetHoursInput),
    });
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

  projectOwnerLabel(project: AdminProjectListItem): string {
    return resolveNamedLabel(project.userEmail);
  }

  private emptyCreateForm(): CreateAdminProjectDto {
    return { userId: '', name: '', hourlyRateNet: 100, currency: 'EUR' };
  }

  private normalizeTargetHoursInput(value: number | null | undefined): number | null | undefined {
    if (value == null || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value;
  }

  private registerModalCloseWatchers(): void {
    const reload = (): void => this.facade.loadAdminProjects({ search: this.searchQuery().trim() || undefined });

    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.emptyCreateForm();
        this.createTargetHoursInput = null;
        reload();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: reload,
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.projectToDelete = null;
        reload();
      },
    });
  }
}
