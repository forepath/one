import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ProjectsFacade, type ProjectListItem } from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcEmptyStateComponent,
  FpcInfiniteScrollDirective,
  FpcListAppendFooterComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';

import {
  formatProjectHourlyRate,
  formatProjectMinutes,
  formatProjectOpenBillableAmount,
  getProjectStatusIconClass,
  getProjectStatusLabel,
  getProjectStatusTextClass,
} from '../billing-status-labels';

@Component({
  selector: 'framework-projects-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcEmptyStateComponent,
    FpcInfiniteScrollDirective,
    FpcListAppendFooterComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './projects-page.component.html',
  styleUrls: ['./projects-page.component.scss'],
})
export class ProjectsPageComponent implements OnInit {
  readonly pageTitle = $localize`:@@featureProjects-title:Projects`;
  readonly searchPlaceholder = $localize`:@@featureProjects-searchPlaceholder:Search projects`;

  readonly facade = inject(ProjectsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly projects$ = this.facade.projects$;

  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;
  readonly hasMore$ = this.facade.hasMore$;
  readonly appendLoading$ = this.facade.appendLoading$;
  readonly appendError$ = this.facade.appendError$;
  readonly projects = toSignal(this.facade.projects$, { initialValue: [] as ProjectListItem[] });

  ngOnInit(): void {
    this.facade.loadProjects();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadProjects({ search: search.trim() || undefined });
      });
  }

  projectStatusLabel(status: string): string {
    return getProjectStatusLabel(status);
  }

  projectStatusTextClass(status: string): string {
    return getProjectStatusTextClass(status);
  }

  projectStatusIconClass(status: string): string {
    return getProjectStatusIconClass(status);
  }

  hourlyRateLabel(amount: number, currency: string): string {
    return formatProjectHourlyRate(amount, currency);
  }

  unbilledTimeLabel(minutes: number): string {
    return formatProjectMinutes(minutes);
  }

  openBillableLabel(amount: number, currency: string): string {
    return formatProjectOpenBillableAmount(amount, currency);
  }
}
