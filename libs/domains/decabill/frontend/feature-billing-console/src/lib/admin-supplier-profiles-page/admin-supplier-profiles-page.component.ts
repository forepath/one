import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
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
  FpcBadgeComponent,
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
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';

import { BILLING_COUNTRY_OPTIONS, DEFAULT_BILLING_COUNTRY_CODE } from '../billing-country-options';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import {
  getCountryDisplayName,
  getProfileCompleteLabel,
  getProfileCompleteTextClass,
  getUnavailableLabel,
  getVatIdValidationStatusLabel,
} from '../billing-status-labels';

@Component({
  selector: 'framework-admin-supplier-profiles-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcListItemComponent,
    FpcConfirmDialogComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
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

  readonly pageTitle = $localize`:@@featureAdminSupplierProfiles-title:Supplier Profiles`;
  readonly addProfileAriaLabel = $localize`:@@featureAdminSupplierProfiles-add:Add`;
  readonly searchPlaceholder = $localize`:@@featureAdminSupplierProfiles-searchPlaceholder:Search supplier profiles`;

  private readonly facade = inject(AdminSupplierProfilesFacade);
  private readonly profilesService = inject(AdminSupplierProfilesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly countryOptions = BILLING_COUNTRY_OPTIONS;
  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly profiles$ = this.facade.profiles$;
  readonly loading$ = this.facade.loading$;
  readonly creating$ = this.facade.creating$;
  readonly updating$ = this.facade.updating$;
  readonly deleting$ = this.facade.deleting$;
  readonly customDataSaving$ = this.facade.customDataSaving$;
  readonly error$ = this.facade.error$;

  readonly profiles = toSignal(this.facade.profiles$, { initialValue: [] as AdminSupplierProfileListItem[] });
  readonly customDataSaving = toSignal(this.customDataSaving$, { initialValue: false });

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
    this.facade.loadProfiles();
    this.registerModalCloseWatchers();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadProfiles({ search: search.trim() || undefined });
      });
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
    this.facade.createProfile(this.createForm);
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

    this.facade.updateProfile(id, dto);
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
    if (!value) return '—';

    return this.datePipe.transform(value, 'mediumDate') ?? '—';
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
    const reloadProfiles = (): void => {
      this.facade.loadProfiles();
    };

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
