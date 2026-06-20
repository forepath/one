import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { CustomerProfileDto, CustomerProfileResponse } from '../../types/billing.types';

import { clearCustomerProfile, loadCustomerProfile, updateCustomerProfile } from './customer-profile.actions';
import {
  selectCustomerProfile,
  selectCustomerProfileError,
  selectCustomerProfileLoading,
  selectCustomerProfileLoadingAny,
  selectCustomerProfileUpdating,
  selectHasCustomerProfile,
  selectIsCustomerProfileComplete,
} from './customer-profile.selectors';

@Injectable({
  providedIn: 'root',
})
export class CustomerProfileFacade {
  private readonly store = inject(Store);

  getCustomerProfile$(): Observable<CustomerProfileResponse | null> {
    return this.store.select(selectCustomerProfile);
  }

  getCustomerProfileLoading$(): Observable<boolean> {
    return this.store.select(selectCustomerProfileLoading);
  }

  getCustomerProfileUpdating$(): Observable<boolean> {
    return this.store.select(selectCustomerProfileUpdating);
  }

  getCustomerProfileLoadingAny$(): Observable<boolean> {
    return this.store.select(selectCustomerProfileLoadingAny);
  }

  getCustomerProfileError$(): Observable<string | null> {
    return this.store.select(selectCustomerProfileError);
  }

  hasCustomerProfile$(): Observable<boolean> {
    return this.store.select(selectHasCustomerProfile);
  }

  isCustomerProfileComplete$(): Observable<boolean> {
    return this.store.select(selectIsCustomerProfileComplete);
  }

  loadCustomerProfile(): void {
    this.store.dispatch(loadCustomerProfile());
  }

  updateCustomerProfile(profile: CustomerProfileDto): void {
    this.store.dispatch(updateCustomerProfile({ profile }));
  }

  clearCustomerProfile(): void {
    this.store.dispatch(clearCustomerProfile());
  }
}
