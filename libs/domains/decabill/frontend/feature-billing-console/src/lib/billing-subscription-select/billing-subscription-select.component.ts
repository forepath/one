import { CommonModule } from '@angular/common';
import { Component, computed, input, model, signal } from '@angular/core';
import { type SubscriptionResponse } from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';

import { getSubscriptionStatusLabel } from '../billing-status-labels';
import {
  filterBillingAdminSubscriptions,
  getBillingAdminSubscriptionPlanLabel,
  getBillingAdminSubscriptionPrimaryLabel,
} from '../billing-subscription-select';

@Component({
  selector: 'framework-billing-subscription-select',
  standalone: true,
  imports: [CommonModule, FpcBadgeComponent, FpcTypeaheadSelectComponent],
  templateUrl: './billing-subscription-select.component.html',
  styleUrls: ['./billing-subscription-select.component.scss'],
})
export class BillingSubscriptionSelectComponent {
  /** Eligible / available subscriptions to pick from (local filter). */
  readonly subscriptions = input<SubscriptionResponse[]>([]);
  readonly selectedSubscriptionId = model<string>('');
  readonly disabled = input(false);
  readonly inputId = input('billingSubscriptionSelect');
  readonly placeholder = input(
    $localize`:@@featureBillingSubscriptionSelect-placeholder:Search by number, plan, or ID`,
  );
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

  subscriptionPrimaryLabel(subscription: SubscriptionResponse): string {
    return getBillingAdminSubscriptionPrimaryLabel(subscription);
  }

  subscriptionPlanLabel(subscription: SubscriptionResponse): string {
    return getBillingAdminSubscriptionPlanLabel(subscription);
  }

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  reset(): void {
    this.searchQuery.set('');
    this.suggestionsOpen.set(false);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);

    if (value.trim().length > 0 || this.showSuggestionsOnFocus()) {
      this.suggestionsOpen.set(true);
    } else {
      this.suggestionsOpen.set(false);
    }
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
