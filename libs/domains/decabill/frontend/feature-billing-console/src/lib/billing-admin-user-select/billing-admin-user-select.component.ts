import { CommonModule } from '@angular/common';
import { Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UserResponseDto } from '@forepath/identity/frontend';

import { filterBillingAdminUsers } from '../billing-user-select';

@Component({
  selector: 'framework-billing-admin-user-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './billing-admin-user-select.component.html',
  styleUrls: ['./billing-admin-user-select.component.scss'],
})
export class BillingAdminUserSelectComponent {
  readonly users = input.required<UserResponseDto[]>();
  readonly selectedUserId = model<string>('');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('billingAdminUserSelect');
  readonly placeholder = input($localize`:@@featureBillingAdminUserSelect-placeholder:Search by email or ID`);
  readonly showSuggestionsOnFocus = input(false);
  readonly suggestionLimit = input(20);

  readonly searchQuery = signal('');
  readonly suggestionsOpen = signal(false);

  readonly filteredUsers = computed(() =>
    filterBillingAdminUsers(this.users(), this.searchQuery(), this.suggestionLimit()),
  );

  readonly selectedUser = computed(() => this.users().find((user) => user.id === this.selectedUserId()) ?? null);

  reset(): void {
    this.searchQuery.set('');
    this.suggestionsOpen.set(false);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);

    if (value.trim().length > 0 || this.showSuggestionsOnFocus()) {
      this.suggestionsOpen.set(true);
    }
  }

  onSearchFocus(): void {
    const hasQuery = this.searchQuery().trim().length > 0;

    if ((hasQuery || this.showSuggestionsOnFocus()) && this.filteredUsers().length > 0) {
      this.suggestionsOpen.set(true);
    }
  }

  onSearchBlur(): void {
    setTimeout(() => this.suggestionsOpen.set(false), 180);
  }

  pickUser(user: UserResponseDto, event: Event): void {
    event.preventDefault();
    this.selectedUserId.set(user.id);
    this.reset();
  }

  clearSelection(): void {
    this.selectedUserId.set('');
    this.reset();
  }
}
