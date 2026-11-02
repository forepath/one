import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { ProjectsFacade, type ProjectListItem } from '@forepath/decabill/frontend/data-access-billing-console';
import {
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import {
  formatProjectHourlyRate,
  formatProjectMinutes,
  formatProjectOpenBillableAmount,
} from '../billing-status-labels';
import { dbCopyIdItem, dbOpenItem } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { projectState } from '../shared/table-states';

/** Customer projects: one server-paged table (State · Project · rate · unbilled time · open amount). */
@Component({
  selector: 'framework-projects-page',
  standalone: true,
  imports: [FpcDataTableComponent, FpcEmptyStateComponent, FpcPageHeaderComponent],
  templateUrl: './projects-page.component.html',
  styleUrls: ['./projects-page.component.scss'],
})
export class ProjectsPageComponent {
  readonly pageTitle = $localize`:@@featureProjects-title:Projects`;
  readonly searchPlaceholder = $localize`:@@featureProjects-searchPlaceholder:Search projects`;

  readonly facade = inject(ProjectsFacade);
  private readonly router = inject(Router);

  readonly projects = toSignal(this.facade.projects$, { initialValue: [] as ProjectListItem[] });
  readonly total = toSignal(this.facade.total$, { initialValue: 0 });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });

  /** Search + page + page size → `GET /projects?limit&offset&search` (replace-page). */
  readonly paging = dbServerPaging((query) => this.facade.loadProjects(query));

  readonly columns: FpcTableColumn<ProjectListItem>[] = [
    {
      id: 'status',
      label: $localize`:@@featureProjects-colStatus:Status`,
      type: 'state',
      state: (project) => projectState(project.status),
    },
    {
      id: 'name',
      label: $localize`:@@featureProjects-colProject:Project`,
      value: (project) => project.name,
      required: true,
      priority: 1,
    },
    {
      id: 'rate',
      label: $localize`:@@featureProjects-colHourlyRate:Hourly rate`,
      value: (project) => formatProjectHourlyRate(project.hourlyRateNet, project.currency),
      align: 'end',
      priority: 2,
    },
    {
      id: 'unbilled',
      label: $localize`:@@featureProjects-colUnbilledTime:Unbilled time`,
      value: (project) => formatProjectMinutes(project.unbilledMinutes),
      align: 'end',
      priority: 1,
    },
    {
      id: 'open',
      label: $localize`:@@featureProjects-colOpenAmount:Open amount`,
      value: (project) => formatProjectOpenBillableAmount(project.openBillableAmountNet, project.currency),
      align: 'end',
      priority: 2,
    },
  ];

  readonly projectLink = (project: ProjectListItem): string => `/projects/${encodeURIComponent(project.id)}/board`;
  readonly rowMenu = (): FpcMenuItem[] => [dbOpenItem(), dbCopyIdItem()];

  onRowAction(project: ProjectListItem, action: string): void {
    if (action === 'open') void this.router.navigateByUrl(this.projectLink(project));
    else if (action === 'copy-id') fpcCopyText(project.id);
  }
}
