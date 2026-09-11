import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { AuthService, type UserResponseDto } from '@forepath/identity/frontend';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

@Component({
  selector: 'framework-billing-admin-user-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './billing-admin-user-select.component.html',
  styleUrls: ['./billing-admin-user-select.component.scss'],
})
export class BillingAdminUserSelectComponent {
  /** Optional cache for resolving the selected user label (e.g. full user list on parent page). */
  readonly users = input<UserResponseDto[]>([]);
  readonly selectedUserId = model<string>('');
  readonly size = input<'sm' | 'md'>('md');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('billingAdminUserSelect');
  readonly placeholder = input($localize`:@@featureBillingAdminUserSelect-placeholder:Search by email or ID`);
  readonly showSuggestionsOnFocus = input(false);
  readonly suggestionLimit = input(20);

  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<UserResponseDto[]>([]);
  readonly loading = signal(false);
  private readonly pickedUser = signal<UserResponseDto | null>(null);

  readonly filteredUsers = computed(() => this.searchResults());

  readonly selectedUser = computed(() => {
    const selectedUserId = this.selectedUserId();

    if (!selectedUserId) {
      return null;
    }

    return (
      this.users().find((user) => user.id === selectedUserId) ??
      (this.pickedUser()?.id === selectedUserId ? this.pickedUser() : null) ??
      this.searchResults().find((user) => user.id === selectedUserId) ??
      null
    );
  });

  constructor() {
    effect(() => {
      if (!this.selectedUserId()) {
        this.pickedUser.set(null);
      }
    });

    this.searchQuery$
      .pipe(
        skip(1),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((query) => {
          const term = query.trim();

          if (!term) {
            return of([] as UserResponseDto[]);
          }

          return this.authService
            .listUsers({ search: term, limit: this.suggestionLimit() })
            .pipe(catchError(() => of([] as UserResponseDto[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((users) => {
        this.searchResults.set(users);
        this.loading.set(false);
      });
  }

  reset(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
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
    this.pickedUser.set(user);
    this.selectedUserId.set(user.id);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.suggestionsOpen.set(false);
  }

  clearSelection(): void {
    this.pickedUser.set(null);
    this.selectedUserId.set('');
    this.reset();
  }
}
