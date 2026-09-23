import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ClientsService, type ClientResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

@Component({
  selector: 'framework-client-select',
  standalone: true,
  imports: [CommonModule, FpcBadgeComponent, FpcTypeaheadSelectComponent],
  templateUrl: './client-select.component.html',
  styleUrls: ['./client-select.component.scss'],
})
export class ClientSelectComponent {
  /** Optional cache for resolving the selected client label (e.g. store list on parent page). */
  readonly clients = input<ClientResponseDto[]>([]);
  readonly selectedClientId = model<string>('');
  readonly size = input<'sm' | 'md'>('md');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('clientSelect');
  readonly placeholder = input($localize`:@@featureClientSelect-placeholder:Search by name or ID`);
  readonly showSuggestionsOnFocus = input(false);
  readonly suggestionLimit = input(20);

  private readonly clientsService = inject(ClientsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<ClientResponseDto[]>([]);
  readonly loading = signal(false);
  private readonly pickedClient = signal<ClientResponseDto | null>(null);

  readonly filteredClients = computed(() => this.searchResults());

  readonly selectedClient = computed(() => {
    const selectedClientId = this.selectedClientId();

    if (!selectedClientId) {
      return null;
    }

    return (
      this.clients().find((client) => client.id === selectedClientId) ??
      (this.pickedClient()?.id === selectedClientId ? this.pickedClient() : null) ??
      this.searchResults().find((client) => client.id === selectedClientId) ??
      null
    );
  });

  constructor() {
    effect(() => {
      if (!this.selectedClientId()) {
        this.pickedClient.set(null);
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
            return of([] as ClientResponseDto[]);
          }

          return this.clientsService
            .listClients({ search: term, limit: this.suggestionLimit() })
            .pipe(catchError(() => of([] as ClientResponseDto[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((clients) => {
        this.searchResults.set(clients);
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

    if (term.length > 0 || this.showSuggestionsOnFocus()) {
      this.suggestionsOpen.set(true);
      if (term.length > 0) {
        this.loading.set(true);
        this.searchResults.set([]);
      } else {
        this.loading.set(false);
        this.searchResults.set([]);
      }
    } else {
      this.suggestionsOpen.set(false);
      this.loading.set(false);
      this.searchResults.set([]);
    }
  }

  pickClient(client: ClientResponseDto, event: Event): void {
    event.preventDefault();
    this.pickedClient.set(client);
    this.selectedClientId.set(client.id);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.suggestionsOpen.set(false);
  }

  clearSelection(): void {
    this.pickedClient.set(null);
    this.selectedClientId.set('');
    this.reset();
  }
}
