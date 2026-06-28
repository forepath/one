import { CommonModule } from '@angular/common';
import { Component, computed, effect, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ProjectMilestoneResponse } from '@forepath/decabill/frontend/data-access-billing-console';

import { filterProjectMilestones } from '../project-milestone-select';

@Component({
  selector: 'framework-project-milestone-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-milestone-select.component.html',
  styleUrls: ['./project-milestone-select.component.scss'],
})
export class ProjectMilestoneSelectComponent {
  readonly milestones = input.required<ProjectMilestoneResponse[]>();
  readonly selectedMilestoneId = model<string | null>(null);
  readonly disabled = input(false);
  readonly inputId = input('projectMilestoneSelect');
  readonly placeholder = input($localize`:@@featureProjectMilestoneSelect-placeholder:Search milestones by name`);
  readonly showSuggestionsOnFocus = input(true);
  readonly suggestionLimit = input(20);
  readonly compact = input(false);

  readonly searchQuery = signal('');
  readonly suggestionsOpen = signal(false);

  readonly filteredMilestones = computed(() =>
    filterProjectMilestones(this.milestones(), this.searchQuery(), this.suggestionLimit()),
  );

  readonly selectedMilestone = computed(
    () => this.milestones().find((milestone) => milestone.id === this.selectedMilestoneId()) ?? null,
  );

  constructor() {
    effect(() => {
      this.selectedMilestoneId();
      this.searchQuery.set('');
      this.suggestionsOpen.set(false);
    });
  }

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

    if ((hasQuery || this.showSuggestionsOnFocus()) && this.filteredMilestones().length > 0) {
      this.suggestionsOpen.set(true);
    }
  }

  onSearchBlur(): void {
    setTimeout(() => this.suggestionsOpen.set(false), 180);
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
