import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminCustomerProfilesFacade,
  AdminCustomerProfilesService,
  type AdminCustomerProfileListItem,
  type CustomerTrustLevel,
  type CustomerTrustScoreDetail,
  type CustomerProfileDto,
  type VatIdValidationStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
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
import { BillingAdminUserSelectComponent } from '../billing-admin-user-select/billing-admin-user-select.component';
import {
  getCustomerTrustLevelIconClass,
  getCustomerTrustLevelLabel,
  getCustomerTrustLevelTextClass,
  getCountryDisplayName,
  getProfileCompleteLabel,
  getProfileCompleteTextClass,
  getUnavailableLabel,
  getVatIdValidationStatusLabel,
} from '../billing-status-labels';

@Component({
  selector: 'framework-admin-customer-profiles-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BillingAdminUserSelectComponent,
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
  templateUrl: './admin-customer-profiles-page.component.html',
  styleUrls: ['./admin-customer-profiles-page.component.scss'],
})
export class AdminCustomerProfilesPageComponent implements OnInit {
  @ViewChild('createUserSelect') private createUserSelect?: BillingAdminUserSelectComponent;

  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);
  readonly trustScoreModalOpen = signal(false);
  readonly customDataModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureAdminProfiles-title:Billing Profiles`;
  readonly addProfileAriaLabel = $localize`:@@featureAdminProfiles-add:Add`;
  readonly searchPlaceholder = $localize`:@@featureAdminProfiles-searchPlaceholder:Search profiles`;

  private readonly facade = inject(AdminCustomerProfilesFacade);
  private readonly profilesService = inject(AdminCustomerProfilesService);
  private readonly authFacade = inject(AuthenticationFacade);
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
  readonly trustScoreDetail$ = this.facade.trustScoreDetail$;
  readonly trustScoreLoading$ = this.facade.trustScoreLoading$;
  readonly trustScoreRefreshing$ = this.facade.trustScoreRefreshing$;

  readonly profiles = toSignal(this.facade.profiles$, { initialValue: [] as AdminCustomerProfileListItem[] });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly trustScoreDetail = toSignal(this.trustScoreDetail$, {
    initialValue: null as CustomerTrustScoreDetail | null,
  });
  readonly trustScoreLoading = toSignal(this.trustScoreLoading$, { initialValue: false });
  readonly trustScoreRefreshing = toSignal(this.trustScoreRefreshing$, { initialValue: false });
  readonly customDataSaving = toSignal(this.customDataSaving$, { initialValue: false });

  readonly usersWithoutProfile = computed(() => {
    const profileUserIds = new Set(this.profiles().map((profile) => profile.userId));

    return this.users().filter((user) => !profileUserIds.has(user.id));
  });

  createForm: CustomerProfileDto & { userId: string } = this.emptyCreateForm();
  editForm: CustomerProfileDto & {
    id: string;
    customerNumber?: string;
    datevDebtorNumber?: number | null;
    vatIdValidationStatus?: VatIdValidationStatus;
    vatIdValidatedAt?: string | null;
  } = this.emptyEditForm();
  profileToDelete: AdminCustomerProfileListItem | null = null;
  trustScoreProfile: AdminCustomerProfileListItem | null = null;
  customDataProfile: AdminCustomerProfileListItem | null = null;
  customDataProfileId = '';
  customDataOriginal: Record<string, string> = {};
  customDataRows: Array<{ key: string; value: string; existingKey: boolean }> = [];
  customDataLoading = signal(false);

  ngOnInit(): void {
    this.facade.loadProfiles();
    this.authFacade.loadUsers();
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
    queueMicrotask(() => this.createUserSelect?.reset());
  }

  openEditModal(profile: AdminCustomerProfileListItem): void {
    this.profilesService.getById(profile.id).subscribe({
      next: (full) => {
        this.editForm = {
          id: full.id,
          customerNumber: full.customerNumber,
          datevDebtorNumber: full.datevDebtorNumber ?? null,
          firstName: full.firstName ?? '',
          lastName: full.lastName ?? '',
          company: full.company ?? '',
          customerType: full.customerType ?? 'consumer',
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

  openDeleteModal(profile: AdminCustomerProfileListItem): void {
    this.profileToDelete = profile;
    showBillingModal(this.deleteModalOpen);
  }

  openTrustScoreModal(profile: AdminCustomerProfileListItem): void {
    this.trustScoreProfile = profile;
    this.facade.loadTrustScore(profile.id);
    showBillingModal(this.trustScoreModalOpen);
  }

  openCustomDataModal(profile: AdminCustomerProfileListItem): void {
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
    if (!this.createForm.userId) return;

    const { userId, ...dto } = this.createForm;

    this.facade.createProfile({ userId, ...dto });
  }

  submitEdit(): void {
    if (!this.editForm.id) return;

    const {
      id,
      customerNumber: _customerNumber,
      datevDebtorNumber: _datevDebtorNumber,
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

  recomputeTrustScore(): void {
    if (!this.trustScoreProfile) return;

    this.facade.recomputeTrustScore(this.trustScoreProfile.id);
  }

  formatDate(value?: string): string {
    if (!value) return '—';

    return this.datePipe.transform(value, 'mediumDate') ?? '—';
  }

  datevDebtorNumberDisplay(value: number | null | undefined): string {
    if (value == null) {
      return $localize`:@@featureAdminProfiles-datevDebtorNotAssigned:Not assigned yet`;
    }

    return String(value);
  }

  profilePrimaryTitle(profile: AdminCustomerProfileListItem): string {
    const company = profile.company?.trim();

    if (company) {
      return company;
    }

    return (
      this.profilePersonName(profile) || profile.email?.trim() || profile.userEmail?.trim() || getUnavailableLabel()
    );
  }

  profileSecondaryName(profile: AdminCustomerProfileListItem): string | null {
    if (!profile.company?.trim()) {
      return null;
    }

    return this.profilePersonName(profile) || null;
  }

  profileUserLabel(profile: AdminCustomerProfileListItem): string {
    return profile.userEmail?.trim() || getUnavailableLabel();
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

  profileTrustLabel(level: CustomerTrustLevel | null | undefined): string {
    return getCustomerTrustLevelLabel(level);
  }

  profileTrustTextClass(level: CustomerTrustLevel | null | undefined): string {
    return getCustomerTrustLevelTextClass(level);
  }

  profileTrustIconClass(level: CustomerTrustLevel | null | undefined): string {
    return getCustomerTrustLevelIconClass(level);
  }

  isTrustLightActive(level: CustomerTrustLevel | null | undefined, color: CustomerTrustLevel): boolean {
    return level === color;
  }

  trustScorePointsClass(points: number): string {
    if (points > 0) return 'text-success';

    if (points < 0) return 'text-danger';

    return 'text-secondary';
  }

  private profilePersonName(profile: AdminCustomerProfileListItem): string {
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  }

  private emptyCreateForm(): CustomerProfileDto & { userId: string } {
    return {
      userId: '',
      firstName: '',
      lastName: '',
      company: '',
      customerType: 'consumer',
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

  private emptyEditForm(): CustomerProfileDto & {
    id: string;
    customerNumber?: string;
    datevDebtorNumber?: number | null;
    vatIdValidationStatus?: VatIdValidationStatus;
    vatIdValidatedAt?: string | null;
  } {
    return {
      id: '',
      customerNumber: '',
      datevDebtorNumber: null,
      firstName: '',
      lastName: '',
      company: '',
      customerType: 'consumer',
      vatId: '',
      vatIdValidationStatus: 'none',
      vatIdValidatedAt: null,
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

  private resetCreateForm(): void {
    this.createForm = this.emptyCreateForm();
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
