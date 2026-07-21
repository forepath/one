import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminCustomerProfilesFacade,
  AdminCustomerProfilesService,
  type AdminCustomerProfileListItem,
  type CustomerTrustLevel,
  type CustomerTrustScoreDetail,
  type CustomerProfileDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade, type UserResponseDto } from '@forepath/identity/frontend';
import { combineLatestWith, map } from 'rxjs';

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
} from '../billing-status-labels';

@Component({
  selector: 'framework-admin-customer-profiles-page',
  standalone: true,
  imports: [CommonModule, FormsModule, BillingAdminUserSelectComponent],
  providers: [DatePipe],
  templateUrl: './admin-customer-profiles-page.component.html',
  styleUrls: ['./admin-customer-profiles-page.component.scss'],
})
export class AdminCustomerProfilesPageComponent implements OnInit {
  @ViewChild('createModal', { static: false }) private createModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editModal', { static: false }) private editModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteModal', { static: false }) private deleteModal!: ElementRef<HTMLDivElement>;
  @ViewChild('trustScoreModal', { static: false }) private trustScoreModal!: ElementRef<HTMLDivElement>;
  @ViewChild('createUserSelect') private createUserSelect?: BillingAdminUserSelectComponent;

  private readonly facade = inject(AdminCustomerProfilesFacade);
  private readonly profilesService = inject(AdminCustomerProfilesService);
  private readonly authFacade = inject(AuthenticationFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly countryOptions = BILLING_COUNTRY_OPTIONS;
  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly profiles$ = this.facade.profiles$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([profiles, searchQuery]) => {
      if (!searchQuery.trim()) return profiles;

      const term = searchQuery.trim().toLowerCase();

      return profiles.filter((profile) => JSON.stringify(profile).toLowerCase().includes(term));
    }),
  );

  readonly loading$ = this.facade.loading$;
  readonly creating$ = this.facade.creating$;
  readonly updating$ = this.facade.updating$;
  readonly deleting$ = this.facade.deleting$;
  readonly error$ = this.facade.error$;
  readonly trustScoreDetail$ = this.facade.trustScoreDetail$;
  readonly trustScoreLoading$ = this.facade.trustScoreLoading$;
  readonly trustScoreRefreshing$ = this.facade.trustScoreRefreshing$;

  readonly profiles = toSignal(this.profiles$, { initialValue: [] as AdminCustomerProfileListItem[] });
  readonly users = toSignal(this.authFacade.users$, { initialValue: [] as UserResponseDto[] });
  readonly trustScoreDetail = toSignal(this.trustScoreDetail$, {
    initialValue: null as CustomerTrustScoreDetail | null,
  });
  readonly trustScoreLoading = toSignal(this.trustScoreLoading$, { initialValue: false });
  readonly trustScoreRefreshing = toSignal(this.trustScoreRefreshing$, { initialValue: false });

  readonly usersWithoutProfile = computed(() => {
    const profileUserIds = new Set(this.profiles().map((profile) => profile.userId));

    return this.users().filter((user) => !profileUserIds.has(user.id));
  });

  createForm: CustomerProfileDto & { userId: string } = this.emptyCreateForm();
  editForm: CustomerProfileDto & { id: string } = this.emptyEditForm();
  profileToDelete: AdminCustomerProfileListItem | null = null;
  trustScoreProfile: AdminCustomerProfileListItem | null = null;

  ngOnInit(): void {
    this.facade.loadProfiles();
    this.authFacade.loadUsers();
    this.registerModalCloseWatchers();
  }

  openCreateModal(): void {
    this.resetCreateForm();
    showBillingModal(this.createModal);
    queueMicrotask(() => this.createUserSelect?.reset());
  }

  openEditModal(profile: AdminCustomerProfileListItem): void {
    this.profilesService.getById(profile.id).subscribe({
      next: (full) => {
        this.editForm = {
          id: full.id,
          firstName: full.firstName ?? '',
          lastName: full.lastName ?? '',
          company: full.company ?? '',
          email: full.email ?? '',
          addressLine1: full.addressLine1 ?? '',
          addressLine2: full.addressLine2 ?? '',
          postalCode: full.postalCode ?? '',
          city: full.city ?? '',
          state: full.state ?? '',
          country: full.country ?? DEFAULT_BILLING_COUNTRY_CODE,
          phone: full.phone ?? '',
        };
        showBillingModal(this.editModal);
      },
    });
  }

  openDeleteModal(profile: AdminCustomerProfileListItem): void {
    this.profileToDelete = profile;
    showBillingModal(this.deleteModal);
  }

  openTrustScoreModal(profile: AdminCustomerProfileListItem): void {
    this.trustScoreProfile = profile;
    this.facade.loadTrustScore(profile.id);
    showBillingModal(this.trustScoreModal);
  }

  submitCreate(): void {
    if (!this.createForm.userId) return;

    const { userId, ...dto } = this.createForm;

    this.facade.createProfile({ userId, ...dto });
  }

  submitEdit(): void {
    if (!this.editForm.id) return;

    const { id, ...dto } = this.editForm;

    this.facade.updateProfile(id, dto);
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

  private emptyEditForm(): CustomerProfileDto & { id: string } {
    return {
      id: '',
      firstName: '',
      lastName: '',
      company: '',
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

  private registerModalCloseWatchers(): void {
    const reloadProfiles = (): void => {
      this.facade.loadProfiles();
    };

    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      modal: () => this.createModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetCreateForm();
        reloadProfiles();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      modal: () => this.editModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetEditForm();
        reloadProfiles();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deleting$,
      error$: this.error$,
      modal: () => this.deleteModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.profileToDelete = null;
      },
    });
  }
}
