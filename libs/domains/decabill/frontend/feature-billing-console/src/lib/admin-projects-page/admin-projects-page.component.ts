import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import {
  formatProjectHourlyRate,
  formatProjectMinutes,
  formatProjectOpenBillableAmount,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import {
  DB_DL_CANCEL,
  DB_DL_DELETE,
  dbBulkSummary,
  dbCopyIdItem,
  dbOpenItem,
  type DbBulkResult,
} from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { projectState } from '../shared/table-states';
import { getCustomerLabel, getCustomerSecondaryLabel, type CustomerLabelSource } from '../named-label.util';

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
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcFormFieldComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
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

  private readonly router = inject(Router);

  readonly loading$ = this.facade.loading$;
  readonly creating$ = this.facade.creating$;
  readonly updating$ = this.facade.updating$;
  readonly deleting$ = this.facade.deleting$;
  readonly error$ = this.facade.error$;
  readonly projects = toSignal(this.facade.adminProjects$, { initialValue: [] as AdminProjectListItem[] });
  readonly total = toSignal(this.facade.adminTotal$, { initialValue: 0 });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });

  /** Search + page + page size → `GET /admin/projects?limit&offset&search` (replace-page). */
  readonly paging = dbServerPaging((query) => this.facade.loadAdminProjects(query));

  readonly columns: FpcTableColumn<AdminProjectListItem>[] = [
    {
      id: 'status',
      label: $localize`:@@featureProjects-colStatus:Status`,
      type: 'state',
      state: (project) => projectState(project.status),
    },
    {
      id: 'name',
      label: $localize`:@@featureProjects-colProject:Project`,
      value: (project) => project.name,
      required: true,
      priority: 1,
    },
    {
      id: 'customer',
      label: $localize`:@@featureAdminProjects-colCustomer:Customer`,
      value: (project) => getCustomerLabel(project),
      priority: 1,
    },
    {
      id: 'rate',
      label: $localize`:@@featureProjects-colHourlyRate:Hourly rate`,
      value: (project) => formatProjectHourlyRate(project.hourlyRateNet, project.currency),
      align: 'end',
      priority: 2,
    },
    {
      id: 'unbilled',
      label: $localize`:@@featureProjects-colUnbilledTime:Unbilled time`,
      value: (project) => formatProjectMinutes(project.unbilledMinutes),
      align: 'end',
      priority: 2,
    },
    {
      id: 'open',
      label: $localize`:@@featureProjects-colOpenAmount:Open amount`,
      value: (project) => formatProjectOpenBillableAmount(project.openBillableAmountNet, project.currency),
      align: 'end',
      priority: 3,
    },
  ];

  readonly editLabel = $localize`:@@featureAdminProjects-edit:Edit`;
  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly archiveLabel = $localize`:@@featureAdminProjects-archiveSelected:Archive`;
  readonly bulkDeleteTitle = $localize`:@@featureAdminProjects-bulkDeleteTitle:Delete projects?`;

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedProjects = computed(() => {
    const ids = new Set(this.selected());

    return this.projects().filter((project) => ids.has(project.id));
  });
  readonly canArchiveSelection = computed(
    () =>
      this.selectedProjects().length > 0 && this.selectedProjects().some((project) => project.status !== 'archived'),
  );
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureAdminProjects-bulkDeleteMessage:${this.selectedProjects().length}:count: selected projects will be deleted. Projects with unbilled time are reported and left as they are.`,
  );

  readonly projectLink = (project: AdminProjectListItem): string =>
    this.router.serializeUrl(this.router.createUrlTree([project.id, 'board'], { relativeTo: this.projectsRoute }));
  readonly rowMenu = (): FpcMenuItem[] => [
    dbOpenItem(),
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });

  readonly usersWithoutProject = computed(() => this.users());

  createForm: CreateAdminProjectDto = this.emptyCreateForm();
  editForm: UpdateAdminProjectDto & { id: string } = { id: '', name: '', hourlyRateNet: 0 };
  editTargetHoursInput: number | null = null;
  createTargetHoursInput: number | null = null;
  projectToDelete: AdminProjectListItem | null = null;

  customerLabel(row: CustomerLabelSource): string {
    return getCustomerLabel(row);
  }

  customerTitle(row: CustomerLabelSource): string | null {
    return getCustomerSecondaryLabel(row);
  }

  ngOnInit(): void {
    this.authFacade.loadUsers();
    this.registerModalCloseWatchers();
  }

  onRowAction(project: AdminProjectListItem, action: string): void {
    if (action === 'open') void this.router.navigateByUrl(this.projectLink(project));
    else if (action === 'edit') this.openEditModal(project);
    else if (action === 'delete') this.openDeleteModal(project);
    else if (action === 'copy-id') fpcCopyText(project.id);
  }

  /** Bulk Archive: one `PUT /admin/projects/:id` per active project (same endpoint + authorization as Edit). */
  async archiveSelected(): Promise<void> {
    const projects = this.selectedProjects().filter((project) => project.status !== 'archived');

    if (projects.length === 0) return;

    const result = await fpcRunBulk(projects, (project) =>
      firstValueFrom(this.adminService.update(project.id, { status: 'archived' })),
    );

    this.finishBulk(dbBulkSummary(result, (project) => project.name));
  }

  /** Bulk Delete: one `DELETE /admin/projects/:id` per project (the server refuses projects with unbilled time). */
  async deleteSelected(): Promise<void> {
    const projects = this.selectedProjects();

    if (projects.length === 0) return;

    const result = await fpcRunBulk(projects, (project) => firstValueFrom(this.adminService.delete(project.id)));

    this.finishBulk(dbBulkSummary(result, (project) => project.name));
  }

  private finishBulk(result: DbBulkResult): void {
    this.bulkResult.set(result);
    this.selected.set([]);
    this.paging.reload();
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
    const reload = (): void => this.paging.reload();

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
