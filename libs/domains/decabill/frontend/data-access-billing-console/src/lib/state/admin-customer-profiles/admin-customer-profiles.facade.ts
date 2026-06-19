import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreateAdminCustomerProfileDto, CustomerProfileDto } from '../../types/billing.types';

import {
  createAdminCustomerProfile,
  deleteAdminCustomerProfile,
  loadAdminCustomerProfiles,
  updateAdminCustomerProfile,
} from './admin-customer-profiles.actions';
import {
  selectAdminCustomerProfiles,
  selectAdminCustomerProfilesCreating,
  selectAdminCustomerProfilesDeleting,
  selectAdminCustomerProfilesError,
  selectAdminCustomerProfilesLoading,
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
  readonly error$ = this.store.select(selectAdminCustomerProfilesError);

  loadProfiles(): void {
    this.store.dispatch(loadAdminCustomerProfiles());
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
}
