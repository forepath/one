import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type { CreateAdminCustomerProfileDto, CustomerProfileDto } from '../../types/billing.types';

import {
  createAdminCustomerProfile,
  deleteAdminCustomerProfile,
  loadAdminCustomerProfiles,
  loadAdminCustomerProfileTrustScore,
  recomputeAdminCustomerProfileTrustScore,
  saveAdminCustomerProfileCustomData,
  updateAdminCustomerProfile,
} from './admin-customer-profiles.actions';
import {
  selectAdminCustomerProfiles,
  selectAdminCustomerProfilesCreating,
  selectAdminCustomerProfilesCustomDataSaving,
  selectAdminCustomerProfileTrustScoreDetail,
  selectAdminCustomerProfileTrustScoreLoading,
  selectAdminCustomerProfileTrustScoreRefreshing,
  selectAdminCustomerProfilesDeleting,
  selectAdminCustomerProfilesError,
  selectAdminCustomerProfilesLoading,
  selectAdminCustomerProfilesPage,
  selectAdminCustomerProfilesPageSize,
  selectAdminCustomerProfilesState,
  selectAdminCustomerProfilesTotal,
  selectAdminCustomerProfilesUpdating,
} from './admin-customer-profiles.selectors';

@Injectable()
export class AdminCustomerProfilesFacade {
  private readonly store = inject(Store);

  readonly profiles$ = this.store.select(selectAdminCustomerProfiles);
  readonly loading$ = this.store.select(selectAdminCustomerProfilesLoading);
  readonly creating$ = this.store.select(selectAdminCustomerProfilesCreating);
  readonly updating$ = this.store.select(selectAdminCustomerProfilesUpdating);
  readonly deleting$ = this.store.select(selectAdminCustomerProfilesDeleting);
  readonly customDataSaving$ = this.store.select(selectAdminCustomerProfilesCustomDataSaving);
  readonly error$ = this.store.select(selectAdminCustomerProfilesError);
  readonly trustScoreDetail$ = this.store.select(selectAdminCustomerProfileTrustScoreDetail);
  readonly trustScoreLoading$ = this.store.select(selectAdminCustomerProfileTrustScoreLoading);
  readonly trustScoreRefreshing$ = this.store.select(selectAdminCustomerProfileTrustScoreRefreshing);
  readonly total$ = this.store.select(selectAdminCustomerProfilesTotal);
  readonly page$ = this.store.select(selectAdminCustomerProfilesPage);
  readonly pageSize$ = this.store.select(selectAdminCustomerProfilesPageSize);

  /** Loads page 1 (or the given page) of the filtered profiles; the page replaces the current rows. */
  loadProfiles(params?: { search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadAdminCustomerProfiles({ search: params?.search, page: params?.page, pageSize: params?.pageSize }),
    );
  }

  /** Loads another page of the current search (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminCustomerProfilesState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminCustomerProfiles({ search: state.search ?? undefined, page, pageSize: pageSize ?? state.pageSize }),
        ),
      );
  }

  createProfile(dto: CreateAdminCustomerProfileDto): void {
    this.store.dispatch(createAdminCustomerProfile({ dto }));
  }

  updateProfile(id: string, dto: CustomerProfileDto): void {
    this.store.dispatch(updateAdminCustomerProfile({ id, dto }));
  }

  deleteProfile(id: string): void {
    this.store.dispatch(deleteAdminCustomerProfile({ id }));
  }

  loadTrustScore(id: string): void {
    this.store.dispatch(loadAdminCustomerProfileTrustScore({ id }));
  }

  recomputeTrustScore(id: string): void {
    this.store.dispatch(recomputeAdminCustomerProfileTrustScore({ id }));
  }

  saveCustomData(id: string, original: Record<string, string>, next: Record<string, string>): void {
    this.store.dispatch(saveAdminCustomerProfileCustomData({ id, original, next }));
  }
}
