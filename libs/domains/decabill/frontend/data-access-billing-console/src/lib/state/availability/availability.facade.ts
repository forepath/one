import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  AvailabilityCheckDto,
  AvailabilityResponse,
  PricingPreviewDto,
  PricingPreviewResponse,
} from '../../types/billing.types';

import {
  checkAvailability,
  checkAvailabilityAlternatives,
  clearAvailability,
  previewPricing,
} from './availability.actions';
import {
  selectAvailability,
  selectAvailabilityAlternatives,
  selectAvailabilityAlternativesLoading,
  selectAvailabilityError,
  selectAvailabilityLoading,
  selectAvailabilityLoadingAny,
  selectAvailabilityReason,
  selectHasAlternatives,
  selectIsAvailable,
  selectPricingPreview,
  selectPricingPreviewLoading,
} from './availability.selectors';

@Injectable({
  providedIn: 'root',
})
export class AvailabilityFacade {
  private readonly store = inject(Store);

  getAvailability$(): Observable<AvailabilityResponse | null> {
    return this.store.select(selectAvailability);
  }

  getAvailabilityAlternatives$(): Observable<AvailabilityResponse | null> {
    return this.store.select(selectAvailabilityAlternatives);
  }

  getPricingPreview$(): Observable<PricingPreviewResponse | null> {
    return this.store.select(selectPricingPreview);
  }

  getAvailabilityLoading$(): Observable<boolean> {
    return this.store.select(selectAvailabilityLoading);
  }

  getAvailabilityAlternativesLoading$(): Observable<boolean> {
    return this.store.select(selectAvailabilityAlternativesLoading);
  }

  getPricingPreviewLoading$(): Observable<boolean> {
    return this.store.select(selectPricingPreviewLoading);
  }

  getAvailabilityLoadingAny$(): Observable<boolean> {
    return this.store.select(selectAvailabilityLoadingAny);
  }

  getAvailabilityError$(): Observable<string | null> {
    return this.store.select(selectAvailabilityError);
  }

  isAvailable$(): Observable<boolean> {
    return this.store.select(selectIsAvailable);
  }

  getAvailabilityReason$(): Observable<string | null> {
    return this.store.select(selectAvailabilityReason);
  }

  hasAlternatives$(): Observable<boolean> {
    return this.store.select(selectHasAlternatives);
  }

  checkAvailability(check: AvailabilityCheckDto): void {
    this.store.dispatch(checkAvailability({ check }));
  }

  checkAvailabilityAlternatives(check: AvailabilityCheckDto): void {
    this.store.dispatch(checkAvailabilityAlternatives({ check }));
  }

  previewPricing(preview: PricingPreviewDto): void {
    this.store.dispatch(previewPricing({ preview }));
  }

  clearAvailability(): void {
    this.store.dispatch(clearAvailability());
  }
}
