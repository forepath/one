import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminCustomerProfilesFacade,
  AdminCustomerProfilesService,
  type AdminCustomerProfileListItem,
  type CustomerTrustLevel,
  type CustomerTrustScoreDetail,
  type CustomerTrustScoreFactor,
  type CustomerProfileDto,
  type VatIdValidationStatus,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
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
import { DB_DL_CANCEL, DB_DL_DELETE, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { trustState } from '../shared/table-states';
import { formatBillingDate } from '../billing-format';

@Component({
  selector: 'framework-admin-customer-profiles-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BillingAdminUserSelectComponent,
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

  readonly pageTitle = $localize`:@@featureAdminProfiles-title:Customer profiles`;
  readonly addProfileAriaLabel = $localize`:@@featureAdminProfiles-add:Add`;
  readonly searchPlaceholder = $localize`:@@featureAdminProfiles-searchPlaceholder:Search profiles`;

  private readonly facade = inject(AdminCustomerProfilesFacade);
  private readonly profilesService = inject(AdminCustomerProfilesService);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly countryOptions = BILLING_COUNTRY_OPTIONS;
  /** Search + page + size → `GET /admin/billing/customer-profiles?limit&offset&search` (replace-page; URL q / p / n). */
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

  readonly columns: FpcTableColumn<AdminCustomerProfileListItem>[] = [
    {
      id: 'trust',
      label: $localize`:@@featureAdminProfiles-colTrust:Trust`,
      type: 'state',
      state: (profile) => trustState(profile.trustLevel),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminProfiles-colCustomer:Customer`,
      value: (profile) => this.profilePrimaryTitle(profile),
      required: true,
      priority: 1,
    },
    {
      id: 'customerNumber',
      label: $localize`:@@featureAdminProfiles-colCustomerNumber:Customer no.`,
      value: (profile) => profile.customerNumber ?? '',
      mono: true,
      priority: 1,
    },
    {
      id: 'complete',
      label: $localize`:@@featureAdminProfiles-colProfile:Profile`,
      value: (profile) => this.profileCompleteLabel(profile.isComplete),
      priority: 2,
    },
    {
      id: 'user',
      label: $localize`:@@featureAdminProfiles-colUser:User`,
      value: (profile) => this.profileUserLabel(profile),
      priority: 2,
    },
    {
      id: 'contact',
      label: $localize`:@@featureAdminProfiles-colContact:Contact`,
      value: (profile) => this.profileSecondaryName(profile) ?? '',
      priority: 3,
      // DB-02: secondary columns off by default (column chooser) so the list fits 1440 px with ⋮ visible.
      hidden: true,
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
      hidden: true,
    },
  ];

  readonly trustFactorsLabel = $localize`:@@featureAdminProfiles-trustFactors:Trust factors`;
  readonly trustFactorColumns: FpcTableColumn<CustomerTrustScoreFactor>[] = [
    {
      id: 'name',
      label: $localize`:@@featureAdminProfiles-colFactor:Factor`,
      value: (factor) => factor.label,
      required: true,
      priority: 1,
    },
    {
      id: 'description',
      label: $localize`:@@featureAdminProfiles-colDescription:Description`,
      value: (factor) => factor.description,
      priority: 2,
    },
    {
      id: 'points',
      label: $localize`:@@featureAdminProfiles-colPoints:Points`,
      value: (factor) => factor.points,
      align: 'end',
      priority: 1,
    },
  ];

  readonly deleteLabel = DB_DL_DELETE;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly recomputeLabel = $localize`:@@featureAdminProfiles-bulkRecompute:Recompute trust`;
  readonly bulkDeleteTitle = $localize`:@@featureAdminProfiles-bulkDeleteTitle:Delete billing profiles?`;

  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedProfiles = computed(() => {
    const ids = new Set(this.selected());

    return this.profiles().filter((profile) => ids.has(profile.id));
  });
  readonly bulkDeleteMessage = computed(
    () =>
      $localize`:@@featureAdminProfiles-bulkDeleteMessage:${this.selectedProfiles().length}:count: selected billing profiles will be deleted. This action cannot be undone.`,
  );
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'trust', label: $localize`:@@featureAdminProfiles-trustButtonTitle:View trust score`, icon: 'shield-check' },
    {
      id: 'custom-data',
      label: $localize`:@@featureAdminProfiles-customDataButtonTitle:Edit custom data`,
      icon: 'database',
    },
    { id: 'edit', label: $localize`:@@featureAdminProfiles-editButtonTitle:Edit profile`, icon: 'pencil' },
    { id: 'delete', label: this.deleteLabel, icon: 'trash', danger: true, dividerBefore: true },
    dbCopyIdItem(),
  ];

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
    this.authFacade.loadUsers();
    this.registerModalCloseWatchers();
  }

  onRowAction(profile: AdminCustomerProfileListItem, action: string): void {
    if (action === 'trust') this.openTrustScoreModal(profile);
    else if (action === 'custom-data') this.openCustomDataModal(profile);
    else if (action === 'edit') this.openEditModal(profile);
    else if (action === 'delete') this.openDeleteModal(profile);
    else if (action === 'copy-id') fpcCopyText(profile.id);
  }

  /** Bulk Recompute trust: one `POST /admin/billing/customer-profiles/:id/trust-score/recompute` per profile. */
  async recomputeTrustSelected(): Promise<void> {
    const profiles = this.selectedProfiles();

    if (profiles.length === 0) return;

    const result = await fpcRunBulk(profiles, (profile) =>
      firstValueFrom(this.profilesService.recomputeTrustScore(profile.id)),
    );

    this.finishBulk(dbBulkSummary(result, (profile) => this.profilePrimaryTitle(profile)));
  }

  /** Bulk Delete: one `DELETE /admin/billing/customer-profiles/:id` per profile. */
  async deleteSelected(): Promise<void> {
    const profiles = this.selectedProfiles();

    if (profiles.length === 0) return;

    const result = await fpcRunBulk(profiles, (profile) => firstValueFrom(this.profilesService.delete(profile.id)));

    this.finishBulk(dbBulkSummary(result, (profile) => this.profilePrimaryTitle(profile)));
  }

  private finishBulk(result: DbBulkResult): void {
    this.bulkResult.set(result);
    this.selected.set([]);
    this.paging.reload();
  }

  profileUpdatedAt(profile: AdminCustomerProfileListItem): string {
    return profile.updatedAt;
  }

  factorPoints(factor: CustomerTrustScoreFactor): number {
    return factor.points;
  }

  formatPoints(points: number): string {
    return `${points > 0 ? '+' : ''}${points}`;
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

    this.facade.createProfile(withOptionalCountry({ userId, ...dto }));
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

  recomputeTrustScore(): void {
    if (!this.trustScoreProfile) return;

    this.facade.recomputeTrustScore(this.trustScoreProfile.id);
  }

  formatDate(value?: string): string {
    if (!value) return '-';

    return formatBillingDate(value, '-');
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
