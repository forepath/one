import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CreateWebhookEndpointDto,
  UpdateWebhookEndpointDto,
  WebhookDeliveryResponseDto,
  WebhookEndpointResponseDto,
  WebhookEventTypeResponseDto,
} from '../../types/webhook-endpoint.types';

import {
  clearAdminWebhookCreatedSigningSecret,
  clearAdminWebhookDeliveries,
  clearAdminWebhookTestResult,
  clearAdminWebhooksError,
  createAdminWebhook,
  deleteAdminWebhook,
  loadAdminWebhookDeliveries,
  loadAdminWebhookEventTypes,
  loadAdminWebhooks,
  testAdminWebhook,
  updateAdminWebhook,
} from './admin-webhooks.actions';
import {
  selectAdminWebhookDeliveries,
  selectAdminWebhookDeliveriesEndpointId,
  selectAdminWebhookDeliveriesError,
  selectAdminWebhookDeliveriesHasMore,
  selectAdminWebhookDeliveriesLoading,
  selectAdminWebhookDeliveriesTotal,
  selectAdminWebhookEventTypes,
  selectAdminWebhookEventTypesError,
  selectAdminWebhookEventTypesLoading,
  selectAdminWebhookLastCreatedSigningSecret,
  selectAdminWebhookLastTestDelivery,
  selectAdminWebhooks,
  selectAdminWebhooksDeleting,
  selectAdminWebhooksError,
  selectAdminWebhooksLoading,
  selectAdminWebhooksSaving,
  selectAdminWebhooksTesting,
} from './admin-webhooks.selectors';

@Injectable({
  providedIn: 'root',
})
export class AdminWebhooksFacade {
  private readonly store = inject(Store);

  readonly endpoints$: Observable<WebhookEndpointResponseDto[]> = this.store.select(selectAdminWebhooks);
  readonly loading$: Observable<boolean> = this.store.select(selectAdminWebhooksLoading);
  readonly error$: Observable<string | null> = this.store.select(selectAdminWebhooksError);
  readonly saving$: Observable<boolean> = this.store.select(selectAdminWebhooksSaving);
  readonly deleting$: Observable<boolean> = this.store.select(selectAdminWebhooksDeleting);
  readonly testing$: Observable<boolean> = this.store.select(selectAdminWebhooksTesting);
  readonly eventTypes$: Observable<WebhookEventTypeResponseDto[]> = this.store.select(selectAdminWebhookEventTypes);
  readonly eventTypesLoading$: Observable<boolean> = this.store.select(selectAdminWebhookEventTypesLoading);
  readonly eventTypesError$: Observable<string | null> = this.store.select(selectAdminWebhookEventTypesError);
  readonly lastCreatedSigningSecret$: Observable<string | null> = this.store.select(
    selectAdminWebhookLastCreatedSigningSecret,
  );
  readonly lastTestDelivery$: Observable<WebhookDeliveryResponseDto | null> = this.store.select(
    selectAdminWebhookLastTestDelivery,
  );
  readonly deliveries$: Observable<WebhookDeliveryResponseDto[]> = this.store.select(selectAdminWebhookDeliveries);
  readonly deliveriesTotal$: Observable<number> = this.store.select(selectAdminWebhookDeliveriesTotal);
  readonly deliveriesLoading$: Observable<boolean> = this.store.select(selectAdminWebhookDeliveriesLoading);
  readonly deliveriesError$: Observable<string | null> = this.store.select(selectAdminWebhookDeliveriesError);
  readonly deliveriesEndpointId$: Observable<string | null> = this.store.select(selectAdminWebhookDeliveriesEndpointId);
  readonly deliveriesHasMore$: Observable<boolean> = this.store.select(selectAdminWebhookDeliveriesHasMore);

  load(): void {
    this.store.dispatch(loadAdminWebhooks());
  }

  loadEventTypes(): void {
    this.store.dispatch(loadAdminWebhookEventTypes());
  }

  create(dto: CreateWebhookEndpointDto): void {
    this.store.dispatch(createAdminWebhook({ dto }));
  }

  update(id: string, dto: UpdateWebhookEndpointDto): void {
    this.store.dispatch(updateAdminWebhook({ id, dto }));
  }

  delete(id: string): void {
    this.store.dispatch(deleteAdminWebhook({ id }));
  }

  test(id: string): void {
    this.store.dispatch(testAdminWebhook({ id }));
  }

  loadDeliveries(id: string): void {
    this.store.dispatch(loadAdminWebhookDeliveries({ id }));
  }

  clearDeliveries(): void {
    this.store.dispatch(clearAdminWebhookDeliveries());
  }

  clearCreatedSigningSecret(): void {
    this.store.dispatch(clearAdminWebhookCreatedSigningSecret());
  }

  clearTestResult(): void {
    this.store.dispatch(clearAdminWebhookTestResult());
  }

  clearError(): void {
    this.store.dispatch(clearAdminWebhooksError());
  }
}
