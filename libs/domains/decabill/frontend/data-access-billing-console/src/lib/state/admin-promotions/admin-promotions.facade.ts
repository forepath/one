import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { take } from 'rxjs';

import type { CreateAdminPromotionDto, UpdateAdminPromotionDto } from '../../types/promotions.types';

import {
  createAdminPromotion,
  deactivateAdminPromotion,
  loadAdminPromotionRedemptions,
  loadAdminPromotions,
  updateAdminPromotion,
} from './admin-promotions.actions';
import {
  selectAdminPromotionRedemptions,
  selectAdminPromotionRedemptionsLoading,
  selectAdminPromotions,
  selectAdminPromotionsCreating,
  selectAdminPromotionsDeactivating,
  selectAdminPromotionsError,
  selectAdminPromotionsLoading,
  selectAdminPromotionsPage,
  selectAdminPromotionsPageSize,
  selectAdminPromotionsState,
  selectAdminPromotionsTotal,
  selectAdminPromotionRedemptionsTotal,
  selectAdminPromotionsUpdating,
} from './admin-promotions.selectors';

@Injectable()
export class AdminPromotionsFacade {
  private readonly store = inject(Store);

  getPromotions$() {
    return this.store.select(selectAdminPromotions);
  }

  getLoading$() {
    return this.store.select(selectAdminPromotionsLoading);
  }

  getTotal$() {
    return this.store.select(selectAdminPromotionsTotal);
  }

  getPage$() {
    return this.store.select(selectAdminPromotionsPage);
  }

  getPageSize$() {
    return this.store.select(selectAdminPromotionsPageSize);
  }

  getRedemptionsTotal$() {
    return this.store.select(selectAdminPromotionRedemptionsTotal);
  }

  getRedemptions$() {
    return this.store.select(selectAdminPromotionRedemptions);
  }

  getRedemptionsLoading$() {
    return this.store.select(selectAdminPromotionRedemptionsLoading);
  }

  getCreating$() {
    return this.store.select(selectAdminPromotionsCreating);
  }

  getUpdating$() {
    return this.store.select(selectAdminPromotionsUpdating);
  }

  getDeactivating$() {
    return this.store.select(selectAdminPromotionsDeactivating);
  }

  getError$() {
    return this.store.select(selectAdminPromotionsError);
  }

  /** Loads page 1 (or the given page) of the filtered promotions; the page replaces the current rows. */
  loadPromotions(params?: { search?: string; page?: number; pageSize?: number }): void {
    this.store.dispatch(
      loadAdminPromotions({ search: params?.search, page: params?.page, pageSize: params?.pageSize }),
    );
  }

  /** Loads another page of the current search (replace-page). */
  loadPage(page: number, pageSize?: number): void {
    this.store
      .select(selectAdminPromotionsState)
      .pipe(take(1))
      .subscribe((state) =>
        this.store.dispatch(
          loadAdminPromotions({ search: state.search ?? undefined, page, pageSize: pageSize ?? state.pageSize }),
        ),
      );
  }

  /** One page of a promotion's redemptions (replace-page; 1-based page). */
  loadRedemptions(promotionId: string, page?: number, pageSize?: number): void {
    this.store.dispatch(loadAdminPromotionRedemptions({ promotionId, page, pageSize }));
  }

  createPromotion(dto: CreateAdminPromotionDto): void {
    this.store.dispatch(createAdminPromotion({ dto }));
  }

  updatePromotion(id: string, dto: UpdateAdminPromotionDto): void {
    this.store.dispatch(updateAdminPromotion({ id, dto }));
  }

  deactivatePromotion(id: string): void {
    this.store.dispatch(deactivateAdminPromotion({ id }));
  }
}
