import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type { CreateAdminSupplierProfileDto, SupplierProfileDto } from '../../types/suppliers.types';

import {
  createAdminSupplierProfile,
  deleteAdminSupplierProfile,
  loadAdminSupplierProfiles,
  saveAdminSupplierProfileCustomData,
  updateAdminSupplierProfile,
} from './admin-supplier-profiles.actions';
import {
  selectAdminSupplierProfiles,
  selectAdminSupplierProfilesCreating,
  selectAdminSupplierProfilesCustomDataSaving,
  selectAdminSupplierProfilesDeleting,
  selectAdminSupplierProfilesError,
  selectAdminSupplierProfilesLoading,
  selectAdminSupplierProfilesPage,
  selectAdminSupplierProfilesPageSize,
  selectAdminSupplierProfilesState,
  selectAdminSupplierProfilesTotal,
  selectAdminSupplierProfilesUpdating,
} from './admin-supplier-profiles.selectors';

@Injectable()
export class AdminSupplierProfilesFacade {
  private readonly store = inject(Store);

  readonly profiles$ = this.store.select(selectAdminSupplierProfiles);
  readonly loading$ = this.store.select(selectAdminSupplierProfilesLoading);
  readonly creating$ = this.store.select(selectAdminSupplierProfilesCreating);
  readonly updating$ = this.store.select(selectAdminSupplierProfilesUpdating);
  readonly deleting$ = this.store.select(selectAdminSupplierProfilesDeleting);
  readonly customDataSaving$ = this.store.select(selectAdminSupplierProfilesCustomDataSaving);
  readonly error$ = this.store.select(selectAdminSupplierProfilesError);
  readonly total$ = this.store.select(selectAdminSupplierProfilesTotal);
  readonly page$ = this.store.select(selectAdminSupplierProfilesPage);
  readonly pageSize$ = this.store.select(selectAdminSupplierProfilesPageSize);

  /** Loads page 1 (or the given page) of the filtered profiles; the page replaces the current rows. */
  loadProfiles(params?: { search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadAdminSupplierProfiles({ search: params?.search, page: params?.page, pageSize: params?.pageSize }),
    );
  }

  /** Loads another page of the current search (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminSupplierProfilesState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminSupplierProfiles({ search: state.search ?? undefined, page, pageSize: pageSize ?? state.pageSize }),
        ),
      );
  }

  createProfile(dto: CreateAdminSupplierProfileDto): void {
    this.store.dispatch(createAdminSupplierProfile({ dto }));
  }

  updateProfile(id: string, dto: SupplierProfileDto): void {
    this.store.dispatch(updateAdminSupplierProfile({ id, dto }));
  }

  deleteProfile(id: string): void {
    this.store.dispatch(deleteAdminSupplierProfile({ id }));
  }

  saveCustomData(id: string, original: Record<string, string>, next: Record<string, string>): void {
    this.store.dispatch(saveAdminSupplierProfileCustomData({ id, original, next }));
  }
}
