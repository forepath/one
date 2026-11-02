import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
  FpcDataTableComponent,
  fpcListQueryState,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  FpcTabComponent,
  FpcTabGroupComponent,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { filterBySearch } from '../list-search';
import { LoadweaverCreateKindButtonComponent } from '../nav/create-kind-button.component';
import { CREATE_HINT } from '../nav/create-kinds';
import { resourceKey, resourceLink } from '../resources/resource-format';
import { ResourceModalService } from '../objects/resource-modal.service';
import { LoadweaverIncidentModalComponent } from './incident-modal.component';
import {
  INCIDENT_STATUS_TONE,
  incidentStatusLabel,
  latestUpdate,
  mayWriteIncidents,
  sortIncidents,
  statusPageUrl,
} from './status-page-format';
import { savedViewBinding } from '../views/saved-views';
import { LoadweaverSavedViewsComponent } from '../views/saved-views.component';

/**
 * Status pages and incidents (3.25): the projects' `StatusPage` resources (edited as resources, opened on their
 * hostname) and the incident notes they show, written by the projects' operators. Two lanes (3.38): Status pages
 * (all readable projects, own search) | Incidents (per project: the project is the lane strip's filter, own search).
 */
@Component({
  selector: 'loadweaver-status-pages-page',
  imports: [
    LoadweaverCreateKindButtonComponent,
    LoadweaverSavedViewsComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    FpcAlertComponent,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcDataTableComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    FpcEmptyStateComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcPageHeaderComponent,
    FpcTabComponent,
    FpcTabGroupComponent,
    LoadweaverIncidentModalComponent,
  ],
  templateUrl: './status-pages-page.component.html',
  styleUrl: './status-pages-page.component.scss',
  standalone: true,
})
export class LoadweaverStatusPagesPageComponent implements OnInit {
  private readonly facade = inject(ConsoleStatusPagesFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly resourceModal = inject(ResourceModalService);
  private readonly document = inject(DOCUMENT);

  readonly pages = toSignal(this.facade.pages$, { initialValue: [] as StatusPageResource[] });
  readonly pagesLoading = toSignal(this.facade.pagesLoading$, { initialValue: false });
  readonly pagesError = toSignal(this.facade.pagesError$, { initialValue: null });
  readonly incidents = toSignal(this.facade.incidents$, { initialValue: [] as Incident[] });
  readonly incidentsLoading = toSignal(this.facade.incidentsLoading$, { initialValue: false });
  readonly incidentsError = toSignal(this.facade.incidentsError$, { initialValue: null });
  readonly actionError = toSignal(this.facade.actionError$, { initialValue: null });
  readonly me = toSignal(this.access.me$, { initialValue: null });
  readonly memberProjects = toSignal(this.access.projects$, { initialValue: [] as string[] });

  /** Phone lane tab (below md one lane at a time). */
  readonly lane = signal<'pages' | 'incidents'>('pages');
  readonly project = signal<string | null>(null);
  /** The incident whose updates are open (row detail). */
  readonly expanded = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly modalIncident = signal<Incident | null>(null);
  readonly filtersOpen = signal(false);

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
  /** Incidents lane search (URL `?q=` with the project filter). */
  readonly search = signal('');
  /** Status pages lane search (client-side). */
  readonly pagesSearch = signal('');
  /** "Views ▾" (3.37): saved search / filters of this list, per user. */
  readonly views = savedViewBinding({ project: this.project, search: this.search, pagesSearch: this.pagesSearch });
  readonly shownIncidents = computed(() =>
    filterBySearch(this.sortedIncidents(), this.search(), (i) => [
      i.title,
      incidentStatusLabel(i.status),
      ...i.updates.map((u) => u.message),
    ]),
  );
  readonly shownPages = computed(() =>
    filterBySearch(this.pages(), this.pagesSearch(), (p) => [
      p.spec.title,
      p.metadata.project,
      p.metadata.name,
      p.spec.host,
      p.spec.description,
    ]),
  );
  readonly openCount = computed(() => this.incidents().filter((i) => i.status !== 'resolved').length);
  readonly mayWrite = computed(() => mayWriteIncidents(this.me(), this.project()));

  readonly statusTone = INCIDENT_STATUS_TONE;
  readonly statusLabel = incidentStatusLabel;
  readonly latestUpdate = latestUpdate;
  readonly pageUrl = statusPageUrl;
  readonly pageLink = (page: StatusPageResource) => resourceLink(resourceKey(page));

  /** Applied filters (+ search) in the URL; the drawer edits a draft until Apply (3.38 R12). */
  readonly filterState = fpcListQueryState({
    filters: { project: this.project },
    search: this.search,
    open: this.filtersOpen,
    changed: () => this.selectProject(this.project() ?? ''),
  });
  readonly title = $localize`:@@lwConsoleStatusPages-title:Status pages`;
  readonly tabPages = $localize`:@@lwConsoleStatusPages-tabPages:Status pages`;
  readonly tabIncidents = $localize`:@@lwConsoleStatusPages-tabIncidents:Incidents`;
  readonly refreshLabel = $localize`:@@lwConsoleStatusPages-refresh:Refresh`;
  readonly searchLabel = $localize`:@@lwConsoleStatusPages-search:Search status pages`;
  readonly incidentsSearchLabel = $localize`:@@lwConsoleStatusPages-searchIncidents:Search incidents`;
  readonly pagesLoadingLabel = $localize`:@@lwConsoleStatusPages-pagesLoading:Loading status pages`;
  readonly incidentsLoadingLabel = $localize`:@@lwConsoleStatusPages-incidentsLoading:Loading incidents`;
  readonly projectLabel = $localize`:@@lwConsoleStatusPages-project:Project`;
  readonly newIncidentLabel = $localize`:@@lwConsoleStatusPages-newIncident:New incident`;
  readonly openPageLabel = $localize`:@@lwConsoleStatusPages-openPage:Open`;
  readonly editLabel = $localize`:@@lwConsoleStatusPages-edit:Edit`;
  readonly createHint = CREATE_HINT;
  readonly postUpdateLabel = $localize`:@@lwConsoleStatusPages-postUpdate:Update`;
  readonly showsUptimeLabel = $localize`:@@lwConsoleStatusPages-showsUptime:shows uptime`;
  readonly updatesTitle = $localize`:@@lwConsoleStatusPages-updatesTitle:Updates`;

  /** 3.38 D1: Title (→ object page) · project · host · services · uptime; ⋮ open the public page / edit. */
  readonly pageColumns: FpcTableColumn<StatusPageResource>[] = [
    {
      id: 'title',
      label: $localize`:@@lwConsoleStatusPages-colTitle:Title`,
      value: (p) => p.spec.title,
      required: true,
      priority: 1,
    },
    {
      id: 'project',
      label: this.projectLabel,
      value: (p) => p.metadata.project ?? '',
      priority: 2,
    },
    {
      id: 'name',
      label: $localize`:@@lwConsoleStatusPages-colName:Name`,
      value: (p) => p.metadata.name,
      mono: true,
      priority: 3,
    },
    {
      id: 'host',
      label: $localize`:@@lwConsoleStatusPages-colHost:Host`,
      value: (p) => p.spec.host,
      mono: true,
      priority: 1,
    },
    {
      id: 'services',
      label: $localize`:@@lwConsoleStatusPages-colServices:Services`,
      value: (p) => p.spec.services.length,
      align: 'end',
      width: '6rem',
      priority: 2,
    },
    {
      id: 'uptime',
      label: $localize`:@@lwConsoleStatusPages-colUptime:Uptime`,
      value: (p) => (p.spec.showUptime !== false ? 1 : 0),
      width: '6rem',
      priority: 3,
    },
  ];

  /** Incidents: State · Title · created · resolved · updates; the timeline in the row detail; ⋮ post an update. */
  readonly incidentColumns: FpcTableColumn<Incident>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleStatusPages-colStatus:Status`,
      type: 'state',
      state: (i) => ({ label: incidentStatusLabel(i.status), tone: INCIDENT_STATUS_TONE[i.status] }),
    },
    {
      id: 'title',
      label: $localize`:@@lwConsoleStatusPages-colTitle:Title`,
      value: (i) => i.title,
      required: true,
      priority: 1,
    },
    {
      id: 'created',
      label: $localize`:@@lwConsoleStatusPages-colCreated:Created`,
      value: (i) => i.createdAt,
      priority: 1,
    },
    {
      id: 'resolved',
      label: $localize`:@@lwConsoleStatusPages-colResolved:Resolved`,
      value: (i) => i.resolvedAt ?? null,
      priority: 2,
    },
    {
      id: 'updates',
      label: this.updatesTitle,
      value: (i) => i.updates.length,
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    {
      id: 'latest',
      label: $localize`:@@lwConsoleStatusPages-colLatest:Latest update`,
      value: (i) => latestUpdate(i)?.message ?? '',
      priority: 3,
    },
  ];

  /** The timeline (nested): State · time · by · message. */
  readonly updateColumns: FpcTableColumn<Incident['updates'][number]>[] = [
    {
      id: 'status',
      label: $localize`:@@lwConsoleStatusPages-colStatus:Status`,
      type: 'state',
      state: (u) => ({ label: incidentStatusLabel(u.status), tone: INCIDENT_STATUS_TONE[u.status] }),
    },
    {
      id: 'at',
      label: $localize`:@@lwConsoleStatusPages-colAt:Time`,
      value: (u) => u.at,
      required: true,
      priority: 1,
    },
    { id: 'by', label: $localize`:@@lwConsoleStatusPages-colBy:By`, value: (u) => u.by ?? '', priority: 2 },
    {
      id: 'message',
      label: $localize`:@@lwConsoleStatusPages-colMessage:Message`,
      value: (u) => u.message,
      priority: 1,
    },
  ];

  readonly pageId = (p: StatusPageResource) => `${p.metadata.project ?? ''}/${p.metadata.name}`;
  readonly pageRowLink = (p: StatusPageResource) =>
    this.pageLink(p)
      .map((part, i) => (i === 0 ? part : encodeURIComponent(part)))
      .join('/');
  readonly updateId = (u: Incident['updates'][number]) => u.at;
  readonly pageMenu = (): FpcMenuItem[] => [
    { id: 'open-public', label: this.openPageLabel, icon: 'box-arrow-up-right' },
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
  ];
  readonly incidentMenu = (): FpcMenuItem[] =>
    this.mayWrite() ? [{ id: 'update', label: this.postUpdateLabel, icon: 'chat-left-text' }] : [];

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
    if (this.route.snapshot.queryParamMap.get('tab') === 'incidents') this.lane.set('incidents');

    this.facade.loadPages();
  }

  refresh(): void {
    this.facade.loadPages();

    const project = this.project();

    if (project) this.facade.loadIncidents(project);
  }

  selectProject(project: string): void {
    this.project.set(project);
    this.expanded.set(null);
    this.facade.loadIncidents(project);
  }

  toggle(incident: Incident): void {
    this.expanded.update((id) => (id === incident.id ? null : incident.id));
  }

  onPageAction(page: StatusPageResource, action: string): void {
    if (action === 'open-public') this.document.defaultView?.open(statusPageUrl(page), '_blank', 'noopener');
    else if (action === 'edit') this.resourceModal.openEdit(resourceKey(page));
  }

  onIncidentAction(incident: Incident, action: string): void {
    if (action === 'update') this.postUpdate(incident);
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
