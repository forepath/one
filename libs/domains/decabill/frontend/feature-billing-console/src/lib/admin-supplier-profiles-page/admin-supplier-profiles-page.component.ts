import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminSupplierProfilesFacade,
  AdminSupplierProfilesService,
  type AdminSupplierProfileListItem,
  type SupplierProfileDto,
  type VatIdValidationStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcSpinnerComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { firstValueFrom } from 'rxjs';

import { BILLING_COUNTRY_OPTIONS, DEFAULT_BILLING_COUNTRY_CODE, withOptionalCountry } from '../billing-country-options';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import {
  getCountryDisplayName,
  getProfileCompleteLabel,
  getProfileCompleteTextClass,
  getUnavailableLabel,
  getVatIdValidationStatusLabel,
} from '../billing-status-labels';
import { DB_DL_CANCEL, DB_DL_DELETE, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { profileCompleteState } from '../shared/table-states';
import { formatBillingDate } from '../billing-format';

@Component({
  selector: 'framework-admin-supplier-profiles-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTableCellDirective,
  ],
  providers: [DatePipe],
  templateUrl: './admin-supplier-profiles-page.component.html',
  styleUrls: ['./admin-supplier-profiles-page.component.scss'],
})
export class AdminSupplierProfilesPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly customDataModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureAdminSupplierProfiles-title:Supplier profiles`;
  readonly addProfileAriaLabel = $localize`:@@featureAdminSupplierProfiles-add:Add`;
  readonly searchPlaceholder = $localize`:@@featureAdminSupplierProfiles-searchPlaceholder:Search supplier profiles`;

  private readonly facade = inject(AdminSupplierProfilesFacade);
  private readonly profilesService = inject(AdminSupplierProfilesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly countryOptions = BILLING_COUNTRY_OPTIONS;
  /** Search + page + size → `GET /admin/billing/supplier-profiles?limit&offset&search` (replace-page; URL q / p / n). */
  readonly paging = dbServerPaging(
    (query) => this.facade.loadProfiles({ search: query.search, page: query.page, pageSize: query.pageSize }),
    { url: '' },
  );
  readonly total = toSignal(this.facade.total$, { initialValue: 0 });
  readonly profiles$ = this.facade.profiles$;
  readonly loading$ = this.facade.loading$;
  readonly creating$ = this.facade.creating$;
  readonly updating$ = this.facade.updating$;
  readonly deleting$ = this.facade.deleting$;
  readonly customDataSaving$ = this.facade.customDataSaving$;
  readonly error$ = this.facade.error$;

  readonly profiles = toSignal(this.facade.profiles$, { initialValue: [] as AdminSupplierProfileListItem[] });
  readonly customDataSaving = toSignal(this.customDataSaving$, { initialValue: false });

  readonly columns: FpcTableColumn<AdminSupplierProfileListItem>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminSupplierProfiles-colStatus:Status`,
      type: 'state',
      state: (profile) => profileCompleteState(profile.isComplete),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminSupplierProfiles-colSupplier:Supplier`,
      value: (profile) => this.profilePrimaryTitle(profile),
      required: true,
      priority: 1,
    },
    {
      id: 'supplierNumber',
      label: $localize`:@@featureAdminSupplierProfiles-colSupplierNumber:Supplier no.`,
      value: (profile) => profile.supplierNumber ?? '',
      mono: true,
      priority: 1,
    },
    {
      id: 'email',
      label: $localize`:@@featureAdminSupplierProfiles-colEmail:Email`,
      value: (profile) => profile.email ?? '',
      priority: 2,
    },
    {
      id: 'contact',
      label: $localize`:@@featureAdminProfiles-colContact:Contact`,
      value: (profile) => this.profileSecondaryName(profile) ?? '',
      priority: 3,
    },
    {
      id: 'country',
      label: $localize`:@@featureAdminProfiles-colCountry:Country`,
      value: (profile) => this.profileCountryLabel(profile.country),
      priority: 3,
    },
    {
      id: 'updated',
      label: $localize`:@@featureAdminProfiles-colUpdated:Updated`,
      value: (profile) => profile.updatedAt,
      priority: 3,
    },
  ];

  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly bulkDeleteTitle = $localize`:@@featureAdminSupplierProfiles-bulkDeleteTitle:Delete supplier profiles?`;

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedProfiles = computed(() => {
    const ids = new Set(this.selected());

    return this.profiles().filter((profile) => ids.has(profile.id));
  });
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureAdminSupplierProfiles-bulkDeleteMessage:${this.selectedProfiles().length}:count: selected supplier profiles will be deleted. This action cannot be undone.`,
  );
  readonly rowMenu = (): FpcMenuItem[] => [
    {
      id: 'custom-data',
      label: $localize`:@@featureAdminSupplierProfiles-customDataButtonTitle:Edit custom data`,
      icon: 'database',
    },
    { id: 'edit', label: $localize`:@@featureAdminSupplierProfiles-editButtonTitle:Edit profile`, icon: 'pencil' },
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];

  createForm: SupplierProfileDto = this.emptyForm();
  editForm: SupplierProfileDto & {
    id: string;
    supplierNumber?: string;
    datevCreditorNumber?: number | null;
    vatIdValidationStatus?: VatIdValidationStatus;
    vatIdValidatedAt?: string | null;
  } = this.emptyEditForm();
  profileToDelete: AdminSupplierProfileListItem | null = null;
  customDataProfile: AdminSupplierProfileListItem | null = null;
  customDataProfileId = '';
  customDataOriginal: Record<string, string> = {};
  customDataRows: Array<{ key: string; value: string; existingKey: boolean }> = [];
  customDataLoading = signal(false);

  ngOnInit(): void {
    this.registerModalCloseWatchers();
  }

  onRowAction(profile: AdminSupplierProfileListItem, action: string): void {
    if (action === 'custom-data') this.openCustomDataModal(profile);
    else if (action === 'edit') this.openEditModal(profile);
    else if (action === 'delete') this.openDeleteModal(profile);
    else if (action === 'copy-id') fpcCopyText(profile.id);
  }

  /** Bulk Delete: one `delete` per supplier profile (same endpoint + authorization as the row Delete). */
  async deleteSelected(): Promise<void> {
    const profiles = this.selectedProfiles();

    if (profiles.length === 0) return;

    const result = await fpcRunBulk(profiles, (profile) => firstValueFrom(this.profilesService.delete(profile.id)));

    this.bulkResult.set(dbBulkSummary(result, (profile) => this.profilePrimaryTitle(profile)));
    this.selected.set([]);
    this.paging.reload();
  }

  profileUpdatedAt(profile: AdminSupplierProfileListItem): string {
    return profile.updatedAt;
  }

  openCreateModal(): void {
    this.resetCreateForm();
    showBillingModal(this.createModalOpen);
  }

  openEditModal(profile: AdminSupplierProfileListItem): void {
    this.profilesService.getById(profile.id).subscribe({
      next: (full) => {
        this.editForm = {
          id: full.id,
          supplierNumber: full.supplierNumber,
          datevCreditorNumber: full.datevCreditorNumber ?? null,
          firstName: full.firstName ?? '',
          lastName: full.lastName ?? '',
          company: full.company ?? '',
          customerType: full.customerType ?? 'business',
          vatId: full.vatId ?? '',
          vatIdValidationStatus: full.vatIdValidationStatus ?? 'none',
          vatIdValidatedAt: full.vatIdValidatedAt ?? null,
          email: full.email ?? '',
          addressLine1: full.addressLine1 ?? '',
          addressLine2: full.addressLine2 ?? '',
          postalCode: full.postalCode ?? '',
          city: full.city ?? '',
          state: full.state ?? '',
          country: full.country ?? DEFAULT_BILLING_COUNTRY_CODE,
          phone: full.phone ?? '',
        };
        showBillingModal(this.editModalOpen);
      },
    });
  }

  openDeleteModal(profile: AdminSupplierProfileListItem): void {
    this.profileToDelete = profile;
    showBillingModal(this.deleteModalOpen);
  }

  openCustomDataModal(profile: AdminSupplierProfileListItem): void {
    this.customDataProfile = profile;
    this.customDataProfileId = profile.id;
    this.customDataOriginal = {};
    this.customDataRows = [];
    this.customDataLoading.set(true);
    showBillingModal(this.customDataModalOpen);
    this.profilesService.getById(profile.id).subscribe({
      next: (full) => {
        const customData = full.customData ?? {};

        this.customDataOriginal = { ...customData };
        this.customDataRows = Object.entries(customData).map(([key, value]) => ({
          key,
          value,
          existingKey: true,
        }));
        this.customDataLoading.set(false);
      },
      error: () => {
        this.customDataLoading.set(false);
      },
    });
  }

  addCustomDataRow(): void {
    this.customDataRows = [...this.customDataRows, { key: '', value: '', existingKey: false }];
  }

  removeCustomDataRow(index: number): void {
    const list = [...this.customDataRows];

    list.splice(index, 1);
    this.customDataRows = list;
  }

  submitCreate(): void {
    this.facade.createProfile(withOptionalCountry(this.createForm));
  }

  submitEdit(): void {
    if (!this.editForm.id) return;

    const {
      id,
      supplierNumber: _supplierNumber,
      datevCreditorNumber: _datevCreditorNumber,
      vatIdValidationStatus: _status,
      vatIdValidatedAt: _validatedAt,
      ...dto
    } = this.editForm;

    this.facade.updateProfile(id, withOptionalCountry(dto));
  }

  submitCustomData(): void {
    if (!this.customDataProfileId || this.customDataLoading() || this.customDataSaving()) return;

    const next: Record<string, string> = {};
    const seenKeys = new Set<string>();

    for (const row of this.customDataRows) {
      const key = row.key.trim();

      if (!key) continue;

      if (seenKeys.has(key)) return;

      seenKeys.add(key);
      next[key] = row.value;
    }

    this.facade.saveCustomData(this.customDataProfileId, this.customDataOriginal, next);
  }

  confirmDelete(): void {
    if (!this.profileToDelete) return;

    this.facade.deleteProfile(this.profileToDelete.id);
  }

  formatDate(value?: string): string {
    if (!value) return '-';

    return formatBillingDate(value, '-');
  }

  datevCreditorNumberDisplay(value: number | null | undefined): string {
    if (value == null) {
      return $localize`:@@featureAdminSupplierProfiles-datevCreditorNotAssigned:Not assigned yet`;
    }

    return String(value);
  }

  profilePrimaryTitle(profile: AdminSupplierProfileListItem): string {
    const company = profile.company?.trim();

    if (company) {
      return company;
    }

    return this.profilePersonName(profile) || profile.email?.trim() || getUnavailableLabel();
  }

  profileSecondaryName(profile: AdminSupplierProfileListItem): string | null {
    if (!profile.company?.trim()) {
      return null;
    }

    return this.profilePersonName(profile) || null;
  }

  profileCountryLabel(country: string | null | undefined): string {
    return getCountryDisplayName(country);
  }

  profileCompleteLabel(isComplete: boolean): string {
    return getProfileCompleteLabel(isComplete);
  }

  profileCompleteTextClass(isComplete: boolean): string {
    return getProfileCompleteTextClass(isComplete);
  }

  vatIdValidationStatusLabel(status: string | null | undefined): string {
    return getVatIdValidationStatusLabel(status);
  }

  private profilePersonName(profile: AdminSupplierProfileListItem): string {
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  }

  private emptyForm(): SupplierProfileDto {
    return {
      firstName: '',
      lastName: '',
      company: '',
      customerType: 'business',
      vatId: '',
      email: '',
      addressLine1: '',
      addressLine2: '',
      postalCode: '',
      city: '',
      state: '',
      country: DEFAULT_BILLING_COUNTRY_CODE,
      phone: '',
    };
  }

  private emptyEditForm(): SupplierProfileDto & {
    id: string;
    supplierNumber?: string;
    datevCreditorNumber?: number | null;
    vatIdValidationStatus?: VatIdValidationStatus;
    vatIdValidatedAt?: string | null;
  } {
    return {
      id: '',
      supplierNumber: '',
      datevCreditorNumber: null,
      ...this.emptyForm(),
      vatIdValidationStatus: 'none',
      vatIdValidatedAt: null,
    };
  }

  private resetCreateForm(): void {
    this.createForm = this.emptyForm();
  }

  private resetEditForm(): void {
    this.editForm = this.emptyEditForm();
  }

  private resetCustomDataForm(): void {
    this.customDataProfile = null;
    this.customDataProfileId = '';
    this.customDataOriginal = {};
    this.customDataRows = [];
    this.customDataLoading.set(false);
  }

  private registerModalCloseWatchers(): void {
    // The current page again (replace-page), so search / page / size stay.
    const reloadProfiles = (): void => this.paging.reload();

    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetCreateForm();
        reloadProfiles();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetEditForm();
        reloadProfiles();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      open: this.deleteModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.profileToDelete = null;
        reloadProfiles();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.customDataSaving$,
      error$: this.error$,
      open: this.customDataModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetCustomDataForm();
      },
    });
  }
}
