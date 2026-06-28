import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ProjectsFacade, type ProjectListItem } from '@forepath/decabill/frontend/data-access-billing-console';
import { combineLatestWith, map } from 'rxjs';

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
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './projects-page.component.html',
  styleUrls: ['./projects-page.component.scss'],
})
export class ProjectsPageComponent implements OnInit {
  private readonly facade = inject(ProjectsFacade);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly projects$ = this.facade.projects$.pipe(
    combineLatestWith(this.searchQuery$),
    map(([projects, q]) => {
      const term = q.trim().toLowerCase();

      if (!term) return projects;

      return projects.filter((p) => p.name.toLowerCase().includes(term));
    }),
  );

  readonly loading$ = this.facade.loading$;
  readonly error$ = this.facade.error$;
  readonly projects = toSignal(this.projects$, { initialValue: [] as ProjectListItem[] });

  ngOnInit(): void {
    this.facade.loadProjects();
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
