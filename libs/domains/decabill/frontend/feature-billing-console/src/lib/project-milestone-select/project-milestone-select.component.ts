import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, input, model, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  ProjectMilestonesService,
  type ProjectMilestoneResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { FpcBadgeComponent, FpcTypeaheadSelectComponent } from '@forepath/shared/frontend/ui-components';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

@Component({
  selector: 'framework-project-milestone-select',
  standalone: true,
  imports: [CommonModule, FpcBadgeComponent, FpcTypeaheadSelectComponent],
  templateUrl: './project-milestone-select.component.html',
  styleUrls: ['./project-milestone-select.component.scss'],
})
export class ProjectMilestoneSelectComponent {
  readonly projectId = input.required<string>();
  /** Optional full list for resolving the selected milestone label. */
  readonly milestones = input<ProjectMilestoneResponse[]>([]);
  readonly selectedMilestoneId = model<string | null>(null);
  readonly disabled = input(false);
  readonly inputId = input('projectMilestoneSelect');
  readonly placeholder = input($localize`:@@featureProjectMilestoneSelect-placeholder:Search milestones by name`);
  readonly showSuggestionsOnFocus = input(true);
  readonly suggestionLimit = input(20);
  readonly compact = input(false);

  private readonly milestonesService = inject(ProjectMilestonesService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly suggestionsOpen = signal(false);
  readonly searchResults = signal<ProjectMilestoneResponse[]>([]);
  readonly loading = signal(false);

  readonly filteredMilestones = computed(() => this.searchResults());

  readonly selectedMilestone = computed(
    () =>
      this.milestones().find((milestone) => milestone.id === this.selectedMilestoneId()) ??
      this.searchResults().find((milestone) => milestone.id === this.selectedMilestoneId()) ??
      null,
  );

  constructor() {
    effect(() => {
      this.selectedMilestoneId();
      this.searchQuery.set('');
      this.searchResults.set([]);
      this.suggestionsOpen.set(false);
    });

    this.searchQuery$
      .pipe(
        skip(1),
        debounceTime(300),
        distinctUntilChanged(),
        tap(() => this.loading.set(true)),
        switchMap((query) => {
          const term = query.trim();
          const projectId = this.projectId()?.trim();

          if (!term || !projectId) {
            return of([] as ProjectMilestoneResponse[]);
          }

          return this.milestonesService
            .list(projectId, { search: term, limit: this.suggestionLimit() })
            .pipe(catchError(() => of([] as ProjectMilestoneResponse[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((milestones) => {
        this.searchResults.set(milestones);
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

  pickMilestone(milestone: ProjectMilestoneResponse, event: Event): void {
    event.preventDefault();
    this.selectedMilestoneId.set(milestone.id);
    this.reset();
  }

  clearSelection(): void {
    this.selectedMilestoneId.set(null);
    this.reset();
  }
}
