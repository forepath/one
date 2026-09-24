import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { AgentsService, type AgentResponseDto } from '@forepath/agenstra/frontend/data-access-agent-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

@Component({
  selector: 'framework-agent-select',
  standalone: true,
  imports: [CommonModule, FpcBadgeComponent, FpcTypeaheadSelectComponent],
  templateUrl: './agent-select.component.html',
  styleUrls: ['./agent-select.component.scss'],
})
export class AgentSelectComponent {
  /** Client whose agents are searchable. */
  readonly clientId = input.required<string>();
  /** Optional cache for resolving the selected agent label (e.g. board-loaded agents). */
  readonly agents = input<AgentResponseDto[]>([]);
  readonly selectedAgentId = model<string | null>(null);
  readonly size = input<'sm' | 'md'>('md');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly inputId = input('agentSelect');
  readonly placeholder = input($localize`:@@featureAgentSelect-placeholder:Search agents by name`);
  readonly showSuggestionsOnFocus = input(false);
  readonly suggestionLimit = input(20);

  private readonly agentsService = inject(AgentsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<AgentResponseDto[]>([]);
  readonly loading = signal(false);
  private readonly pickedAgent = signal<AgentResponseDto | null>(null);

  readonly filteredAgents = computed(() => this.searchResults());

  readonly selectedAgent = computed(() => {
    const selectedAgentId = this.selectedAgentId();

    if (!selectedAgentId) {
      return null;
    }

    return (
      this.agents().find((agent) => agent.id === selectedAgentId) ??
      (this.pickedAgent()?.id === selectedAgentId ? this.pickedAgent() : null) ??
      this.searchResults().find((agent) => agent.id === selectedAgentId) ??
      null
    );
  });

  constructor() {
    effect(() => {
      if (!this.selectedAgentId()) {
        this.pickedAgent.set(null);
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
          const clientId = this.clientId()?.trim();

          if (!term || !clientId) {
            return of([] as AgentResponseDto[]);
          }

          return this.agentsService
            .listClientAgents(clientId, { search: term, limit: this.suggestionLimit() })
            .pipe(catchError(() => of([] as AgentResponseDto[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((agents) => {
        this.searchResults.set(agents);
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

  pickAgent(agent: AgentResponseDto, event: Event): void {
    event.preventDefault();
    this.pickedAgent.set(agent);
    this.selectedAgentId.set(agent.id);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.suggestionsOpen.set(false);
  }

  clearSelection(): void {
    this.pickedAgent.set(null);
    this.selectedAgentId.set(null);
    this.reset();
  }
}
