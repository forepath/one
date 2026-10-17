import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleStatusPagesFacade,
  type Incident,
  type StatusPageResource,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSpinnerComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
} from '@forepath/shared/frontend/ui-components';

import { resourceEditLink, resourceKey, resourceLink } from '../resources/resource-format';
import { LoadweaverIncidentModalComponent } from './incident-modal.component';
import {
  INCIDENT_STATUS_TONE,
  incidentStatusLabel,
  latestUpdate,
  mayPlanStatusPages,
  mayWriteIncidents,
  sortIncidents,
  statusPageUrl,
} from './status-page-format';

/**
 * Status pages and incidents (3.25): the projects' `StatusPage` resources (edited as resources, opened on their
 * hostname) and the incident notes they show, written by the projects' operators.
 */
@Component({
  selector: 'loadweaver-status-pages-page',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcSpinnerComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverIncidentModalComponent,
  ],
  templateUrl: './status-pages-page.component.html',
  standalone: true,
})
export class LoadweaverStatusPagesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleStatusPagesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);

  readonly pages = toSignal(this.facade.pages$, { initialValue: [] as StatusPageResource[] });
  readonly pagesLoading = toSignal(this.facade.pagesLoading$, { initialValue: false });
  readonly pagesError = toSignal(this.facade.pagesError$, { initialValue: null });
  readonly incidents = toSignal(this.facade.incidents$, { initialValue: [] as Incident[] });
  readonly incidentsLoading = toSignal(this.facade.incidentsLoading$, { initialValue: false });
  readonly incidentsError = toSignal(this.facade.incidentsError$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  readonly activeTab = signal<string | null>('pages');
  readonly project = signal<string | null>(null);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly modalOpen = signal(false);
  readonly modalIncident = signal<Incident | null>(null);

  /** Memberships plus the projects that have status pages (cluster roles read every project). */
  readonly projects = computed(() =>
    [
      ...new Set([
        ...this.memberProjects(),
        ...this.pages()
          .map((p) => p.metadata.project)
          .filter((p): p is string => !!p),
      ]),
    ].sort(),
  );
  readonly sortedIncidents = computed(() => sortIncidents(this.incidents()));
  readonly openCount = computed(() => this.incidents().filter((i) => i.status !== 'resolved').length);
  readonly mayWrite = computed(() => mayWriteIncidents(this.me(), this.project()));
  readonly mayPlan = computed(() => mayPlanStatusPages(this.me(), this.project()));

  readonly statusTone = INCIDENT_STATUS_TONE;
  readonly statusLabel = incidentStatusLabel;
  readonly latestUpdate = latestUpdate;
  readonly pageUrl = statusPageUrl;
  readonly pageLink = (page: StatusPageResource) => resourceLink(resourceKey(page));
  readonly pageEditLink = (page: StatusPageResource) => resourceEditLink(resourceKey(page));

  readonly title = $localize`:@@lwConsoleStatusPages-title:Status pages`;
  readonly tabPages = $localize`:@@lwConsoleStatusPages-tabPages:Status pages`;
  readonly tabIncidents = $localize`:@@lwConsoleStatusPages-tabIncidents:Incidents`;
  readonly refreshLabel = $localize`:@@lwConsoleStatusPages-refresh:Refresh`;
  readonly projectLabel = $localize`:@@lwConsoleStatusPages-project:Project`;

  private readonly requestedProject = this.route.snapshot.queryParamMap.get('project');

  constructor() {
    // The first project (or the one asked for) once memberships and pages are known.
    effect(() => {
      const projects = this.projects();

      if (this.project() === null && projects.length > 0) {
        const project =
          this.requestedProject && projects.includes(this.requestedProject) ? this.requestedProject : projects[0];

        this.selectProject(project);
      }
    });
  }

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('tab') === 'incidents') this.activeTab.set('incidents');

    this.facade.loadPages();
  }

  refresh(): void {
    this.facade.loadPages();

    const project = this.project();

    if (project) this.facade.loadIncidents(project);
  }

  selectProject(project: string): void {
    this.project.set(project);
    this.expanded.set(new Set());
    this.facade.loadIncidents(project);
  }

  toggle(incident: Incident): void {
    const next = new Set(this.expanded());

    if (next.has(incident.id)) next.delete(incident.id);
    else next.add(incident.id);

    this.expanded.set(next);
  }

  newIncident(): void {
    this.modalIncident.set(null);
    this.modalOpen.set(true);
  }

  postUpdate(incident: Incident, event?: Event): void {
    event?.stopPropagation();
    this.modalIncident.set(incident);
    this.modalOpen.set(true);
  }

  dismissActionError(): void {
    this.facade.clearActionError();
  }

  /** Updates newest first. */
  updatesOf(incident: Incident): Incident['updates'] {
    return [...incident.updates].reverse();
  }
}
