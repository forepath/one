import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

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

  loadPromotions(): void {
    this.store.dispatch(loadAdminPromotions());
  }

  loadRedemptions(promotionId: string): void {
    this.store.dispatch(loadAdminPromotionRedemptions({ promotionId }));
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
