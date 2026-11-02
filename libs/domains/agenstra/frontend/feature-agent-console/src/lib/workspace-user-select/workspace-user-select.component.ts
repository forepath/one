import { Component, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { isReferenceAccessDenied } from '@forepath/agenstra/frontend/feature-agent-config';
import { AuthService, type UserResponseDto } from '@forepath/identity/frontend';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

/**
 * "Add user to workspace" for global admins (2026-10-29): a user typeahead over the user directory
 * (`AuthService.listUsers({ search, limit })`, admin-only) that stores the picked user's email, the value the
 * add-user call already takes. Same pattern as `client-select` (300 ms debounce, chip + clear, "No users found.").
 * A 401 / 403 emits `denied`, so the caller falls back to the plain email field with a hint (never an error).
 */
@Component({
  selector: 'framework-workspace-user-select',
  standalone: true,
  imports: [FpcBadgeComponent, FpcTypeaheadSelectComponent],
  styleUrls: ['./workspace-user-select.component.scss'],
  template: `
    <div class="workspace-user-select">
      @if (email(); as selected) {
        <fpc-badge
          variant="info"
          color="secondary"
          class="workspace-user-select__chip"
          data-testid="workspace-user-chip"
        >
          <span class="text-truncate">{{ selected }}</span>
          <button
            type="button"
            class="btn-close workspace-user-select__clear"
            [disabled]="disabled()"
            (click)="clearSelection()"
            i18n-aria-label="@@featureWorkspaceUserSelect-clearAria"
            aria-label="Clear selected user"
          ></button>
        </fpc-badge>
      } @else {
        <fpc-typeahead-select
          [inputId]="inputId()"
          [listboxId]="inputId() + '-listbox'"
          [placeholder]="placeholder"
          [disabled]="disabled()"
          [loading]="loading()"
          [openOnFocus]="false"
          [query]="searchQuery()"
          (queryChange)="onSearchChange($event)"
          [open]="suggestionsOpen()"
          (openChange)="suggestionsOpen.set($event)"
          (cleared)="reset()"
          data-testid="workspace-user-typeahead"
        >
          <div fpcTypeaheadSuggestions>
            @if (searchResults().length > 0) {
              @for (user of searchResults(); track user.id) {
                <button
                  type="button"
                  class="dropdown-item py-2 text-start"
                  (mousedown)="pickUser(user, $event)"
                  data-testid="workspace-user-option"
                >
                  <span class="d-block small fw-medium text-truncate">{{ user.email }}</span>
                  <span class="d-block font-monospace text-body-secondary small text-truncate">{{ user.id }}</span>
                </button>
              }
            } @else if (searchQuery().trim() && !loading()) {
              <span class="dropdown-item-text text-body-secondary small" i18n="@@featureWorkspaceUserSelect-noUsers"
                >No users found.</span
              >
            }
          </div>
        </fpc-typeahead-select>
      }
    </div>
  `,
})
export class WorkspaceUserSelectComponent {
  /** The picked user's email ('' = nothing picked). */
  readonly email = model<string>('');
  readonly disabled = input(false);
  readonly inputId = input('workspaceUserSelect');
  readonly suggestionLimit = input(20);

  /** The user directory answered 401 / 403: the caller shows the plain email field instead. */
  readonly denied = output<void>();

  readonly placeholder = $localize`:@@featureWorkspaceUserSelect-placeholder:Search users by email`;

  private readonly authService = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<UserResponseDto[]>([]);
  readonly loading = signal(false);

  constructor() {
    toObservable(this.searchQuery)
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

          return this.authService.listUsers({ search: term, limit: this.suggestionLimit() }).pipe(
            catchError((error: unknown) => {
              if (isReferenceAccessDenied(error)) {
                this.suggestionsOpen.set(false);
                this.denied.emit();
              }

              return of([] as UserResponseDto[]);
            }),
          );
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
    this.loading.set(false);
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    const term = value.trim();

    this.searchResults.set([]);
    this.suggestionsOpen.set(term.length > 0);
    this.loading.set(term.length > 0);
  }

  pickUser(user: UserResponseDto, event: Event): void {
    event.preventDefault();
    this.email.set(user.email);
    this.reset();
  }

  clearSelection(): void {
    this.email.set('');
    this.reset();
  }
}
