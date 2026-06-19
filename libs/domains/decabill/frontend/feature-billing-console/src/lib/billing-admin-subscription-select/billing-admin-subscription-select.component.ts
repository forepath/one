import { CommonModule } from '@angular/common';
import { Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { SubscriptionResponse } from '@forepath/decabill/frontend/data-access-billing-console';

import { getSubscriptionStatusLabel } from '../billing-status-labels';
import {
  filterBillingAdminSubscriptions,
  getBillingAdminSubscriptionPrimaryLabel,
} from '../billing-subscription-select';

@Component({
  selector: 'framework-billing-admin-subscription-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './billing-admin-subscription-select.component.html',
  styleUrls: ['../billing-admin-user-select/billing-admin-user-select.component.scss'],
})
export class BillingAdminSubscriptionSelectComponent {
  readonly subscriptions = input.required<SubscriptionResponse[]>();
  readonly selectedSubscriptionId = model<string>('');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly inputId = input('billingAdminSubscriptionSelect');
  readonly placeholder = input(
    $localize`:@@featureBillingAdminSubscriptionSelect-placeholder:Search by number, plan, or ID`,
  );
  readonly loadingPlaceholder = $localize`:@@featureBillingAdminSubscriptionSelect-loadingPlaceholder:Loading subscriptions...`;
  readonly showSuggestionsOnFocus = input(true);
  readonly suggestionLimit = input(20);

  readonly searchQuery = signal('');
  readonly suggestionsOpen = signal(false);

  readonly filteredSubscriptions = computed(() =>
    filterBillingAdminSubscriptions(this.subscriptions(), this.searchQuery(), this.suggestionLimit()),
  );

  readonly selectedSubscription = computed(
    () => this.subscriptions().find((subscription) => subscription.id === this.selectedSubscriptionId()) ?? null,
  );

  readonly isInputDisabled = computed(() => this.disabled() || this.loading());

  reset(): void {
    this.searchQuery.set('');
    this.suggestionsOpen.set(false);
  }

  subscriptionPrimaryLabel(subscription: SubscriptionResponse): string {
    return getBillingAdminSubscriptionPrimaryLabel(subscription);
  }

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);

    if (value.trim().length > 0 || this.showSuggestionsOnFocus()) {
      this.suggestionsOpen.set(true);
    }
  }

  onSearchFocus(): void {
    const hasQuery = this.searchQuery().trim().length > 0;

    if ((hasQuery || this.showSuggestionsOnFocus()) && this.filteredSubscriptions().length > 0) {
      this.suggestionsOpen.set(true);
    }
  }

  onSearchBlur(): void {
    setTimeout(() => this.suggestionsOpen.set(false), 180);
  }

  pickSubscription(subscription: SubscriptionResponse, event: Event): void {
    event.preventDefault();
    this.selectedSubscriptionId.set(subscription.id);
    this.reset();
  }

  clearSelection(): void {
    this.selectedSubscriptionId.set('');
    this.reset();
  }
}
