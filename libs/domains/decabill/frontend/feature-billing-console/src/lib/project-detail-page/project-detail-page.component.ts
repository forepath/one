import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  ProjectBoardSocketFacade,
  ProjectTimeEntriesFacade,
  ProjectsFacade,
  type AdminProjectDetailResponse,
  type ProjectTimeEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { filter, map, startWith, switchMap, distinctUntilChanged, EMPTY } from 'rxjs';

import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import {
  getProjectTimeEntryBillingStatusIconClass,
  getProjectTimeEntryBillingStatusLabel,
  getProjectTimeEntryBillingStatusTextClass,
  isProjectTimeEntryBilled,
} from '../billing-status-labels';
import { ProjectBoardComponent } from '../project-board/project-board.component';
import { ProjectMilestonesPanelComponent } from '../project-milestones-panel/project-milestones-panel.component';
import { parseProjectDetailTab, type ProjectDetailTab } from './project-detail-tabs';

type ProjectViewMode = 'admin' | 'customer';

@Component({
  selector: 'framework-project-detail-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ProjectBoardComponent, ProjectMilestonesPanelComponent],
  templateUrl: './project-detail-page.component.html',
  styleUrls: ['./project-detail-page.component.scss'],
})
export class ProjectDetailPageComponent implements OnInit {
  @ViewChild('createTimeModal', { static: false }) private createTimeModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editTimeModal', { static: false }) private editTimeModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteTimeModal', { static: false }) private deleteTimeModal!: ElementRef<HTMLDivElement>;

  protected readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsFacade = inject(ProjectsFacade);
  private readonly timeEntriesFacade = inject(ProjectTimeEntriesFacade);
  private readonly socketFacade = inject(ProjectBoardSocketFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isAdminView = signal(false);

  readonly selectedProject$ = this.projectsFacade.selectedProject$;
  readonly summary$ = this.projectsFacade.summary$;
  readonly loadingDetail$ = this.projectsFacade.loadingDetail$;
  readonly loadingSummary$ = this.projectsFacade.loadingSummary$;
  readonly billing$ = this.projectsFacade.billing$;
  readonly error$ = this.projectsFacade.error$;

  readonly timeEntries$ = this.timeEntriesFacade.entries$;
  readonly timeLoading$ = this.timeEntriesFacade.loading$;
  readonly timeSaving$ = this.timeEntriesFacade.saving$;
  readonly timeError$ = this.timeEntriesFacade.error$;

  readonly activeTab = signal<ProjectDetailTab>('board');
  projectId = '';
  private loadedProjectKey = '';

  timeFormStartedAt = '';
  timeFormEndedAt = '';
  timeFormDescription = '';

  editTimeEntryId = '';
  editTimeFormStartedAt = '';
  editTimeFormEndedAt = '';
  editTimeFormDescription = '';
  timeEntryToDelete: ProjectTimeEntryResponse | null = null;

  ngOnInit(): void {
    this.resetTimeForm();
    this.registerTimeEntryModalCloseWatchers();

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => this.readProjectContext()),
        startWith(this.readProjectContext()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((context) => {
        const { projectId, viewMode, tab, rawTab } = context;

        if (projectId && rawTab && rawTab !== tab) {
          void this.router.navigate(this.projectTabLink(projectId, viewMode, tab), { replaceUrl: true });

          return;
        }

        this.projectId = projectId;
        this.isAdminView.set(viewMode === 'admin');
        this.activeTab.set(tab);

        if (!projectId) {
          this.loadedProjectKey = '';
          this.socketFacade.disconnect();

          return;
        }

        const loadKey = `${viewMode}:${projectId}`;

        if (loadKey !== this.loadedProjectKey) {
          this.loadedProjectKey = loadKey;

          if (viewMode === 'admin') {
            this.projectsFacade.loadAdminProjectDetail(projectId);
          } else {
            this.projectsFacade.loadProjectDetail(projectId);
            this.projectsFacade.loadProjectSummary(projectId);
          }
        }

        if (tab === 'time') {
          this.timeEntriesFacade.load(projectId);
        }
      });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => this.readProjectContext().projectId),
        startWith(this.readProjectContext().projectId),
        map((projectId) => projectId.trim()),
        distinctUntilChanged(),
        switchMap((projectId) => {
          if (!projectId) {
            this.socketFacade.disconnect();

            return EMPTY;
          }

          return this.socketFacade.ensureConnectedAndSetProject(projectId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  assigneeEmail(project: unknown): string | undefined {
    return (project as AdminProjectDetailResponse | null)?.userEmail;
  }

  setTab(tab: ProjectDetailTab): void {
    if (!this.projectId || tab === this.activeTab()) return;

    void this.router.navigate(this.projectTabLink(this.projectId, this.isAdminView() ? 'admin' : 'customer', tab));
  }

  tabLabel(tab: ProjectDetailTab): string {
    switch (tab) {
      case 'board':
        return $localize`:@@featureProjectDetail-tabBoard:Board`;
      case 'milestones':
        return $localize`:@@featureProjectDetail-tabMilestones:Milestones`;
      case 'time':
        return $localize`:@@featureProjectDetail-tabTime:Time`;
    }
  }

  billTime(): void {
    if (!this.projectId || !this.isAdminView()) return;

    this.projectsFacade.billProjectTime(this.projectId);
  }

  openCreateTimeModal(): void {
    if (!this.isAdminView()) return;

    this.resetTimeForm();
    showBillingModal(this.createTimeModal);
  }

  submitTimeEntry(): void {
    if (!this.projectId || !this.isAdminView() || !this.isTimeFormValid()) return;

    this.timeEntriesFacade.create(this.projectId, {
      startedAt: this.datetimeLocalToIso(this.timeFormStartedAt),
      endedAt: this.datetimeLocalToIso(this.timeFormEndedAt),
      description: this.timeFormDescription.trim() || undefined,
    });
  }

  openEditTimeModal(entry: ProjectTimeEntryResponse): void {
    if (!this.isAdminView() || !this.isTimeEntryEditable(entry)) return;

    this.editTimeEntryId = entry.id;
    this.editTimeFormStartedAt = this.toDatetimeLocalValue(new Date(entry.startedAt));
    this.editTimeFormEndedAt = this.toDatetimeLocalValue(new Date(entry.endedAt));
    this.editTimeFormDescription = entry.description ?? '';
    showBillingModal(this.editTimeModal);
  }

  submitEditTimeEntry(): void {
    if (!this.projectId || !this.editTimeEntryId || !this.isEditTimeFormValid()) return;

    this.timeEntriesFacade.update(this.projectId, this.editTimeEntryId, {
      startedAt: this.datetimeLocalToIso(this.editTimeFormStartedAt),
      endedAt: this.datetimeLocalToIso(this.editTimeFormEndedAt),
      description: this.editTimeFormDescription.trim() || null,
    });
  }

  openDeleteTimeModal(entry: ProjectTimeEntryResponse): void {
    if (!this.isAdminView() || !this.isTimeEntryEditable(entry)) return;

    this.timeEntryToDelete = entry;
    showBillingModal(this.deleteTimeModal);
  }

  submitDeleteTimeEntry(): void {
    if (!this.projectId || !this.timeEntryToDelete) return;

    this.timeEntriesFacade.remove(this.projectId, this.timeEntryToDelete.id);
  }

  isTimeEntryEditable(entry: ProjectTimeEntryResponse): boolean {
    return !isProjectTimeEntryBilled(entry);
  }

  timeEntryBillingStatusLabel(entry: ProjectTimeEntryResponse): string {
    return getProjectTimeEntryBillingStatusLabel(isProjectTimeEntryBilled(entry));
  }

  timeEntryBillingStatusTextClass(entry: ProjectTimeEntryResponse): string {
    return getProjectTimeEntryBillingStatusTextClass(isProjectTimeEntryBilled(entry));
  }

  timeEntryBillingStatusIconClass(entry: ProjectTimeEntryResponse): string {
    return getProjectTimeEntryBillingStatusIconClass(isProjectTimeEntryBilled(entry));
  }

  isTimeFormValid(): boolean {
    if (!this.timeFormStartedAt || !this.timeFormEndedAt) return false;

    return new Date(this.timeFormEndedAt).getTime() > new Date(this.timeFormStartedAt).getTime();
  }

  isEditTimeFormValid(): boolean {
    if (!this.editTimeFormStartedAt || !this.editTimeFormEndedAt) return false;

    return new Date(this.editTimeFormEndedAt).getTime() > new Date(this.editTimeFormStartedAt).getTime();
  }

  formatTimeEntryClockRange(startedAt: string, endedAt: string): string {
    const start = new Date(startedAt);
    const end = new Date(endedAt);
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

    if (sameDay) {
      return `${start.toLocaleTimeString([], timeOptions)} – ${end.toLocaleTimeString([], timeOptions)}`;
    }

    return `${start.toLocaleString()} – ${end.toLocaleString()}`;
  }

  timeEntryTitle(entry: ProjectTimeEntryResponse): string {
    const description = entry.description?.trim();

    return description || this.formatMinutes(entry.durationMinutes);
  }

  timeEntryShowsDurationInMeta(entry: ProjectTimeEntryResponse): boolean {
    return !!entry.description?.trim();
  }

  formatMinutes(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;

    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  private resetTimeForm(): void {
    const { startedAt, endedAt } = this.defaultTimeRangeLocal();

    this.timeFormStartedAt = startedAt;
    this.timeFormEndedAt = endedAt;
    this.timeFormDescription = '';
  }

  private defaultTimeRangeLocal(): { startedAt: string; endedAt: string } {
    const end = new Date();

    end.setSeconds(0, 0);

    const start = new Date(end.getTime() - 60 * 60 * 1000);

    return {
      startedAt: this.toDatetimeLocalValue(start),
      endedAt: this.toDatetimeLocalValue(end),
    };
  }

  private toDatetimeLocalValue(date: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private datetimeLocalToIso(localValue: string): string {
    return new Date(localValue).toISOString();
  }

  private registerTimeEntryModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.timeSaving$,
      error$: this.timeError$,
      modal: () => this.createTimeModal,
      destroyRef: this.destroyRef,
      onSuccess: () => this.resetTimeForm(),
    });
    watchBillingMutationModalClose({
      loading$: this.timeSaving$,
      error$: this.timeError$,
      modal: () => this.editTimeModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.editTimeEntryId = '';
      },
    });
    watchBillingMutationModalClose({
      loading$: this.timeSaving$,
      error$: this.timeError$,
      modal: () => this.deleteTimeModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.timeEntryToDelete = null;
      },
    });
  }

  private readProjectContext(): {
    projectId: string;
    viewMode: ProjectViewMode;
    tab: ProjectDetailTab;
    rawTab: string | null;
  } {
    let projectId = '';
    let viewMode: ProjectViewMode = 'customer';
    let rawTab: string | null = null;

    for (const route of this.route.pathFromRoot) {
      const routeProjectId = route.snapshot.paramMap.get('projectId');

      if (routeProjectId) {
        projectId = routeProjectId;
      }

      const routeTab = route.snapshot.paramMap.get('tab');

      if (routeTab) {
        rawTab = routeTab;
      }

      const routeViewMode = route.snapshot.data['projectViewMode'];

      if (routeViewMode === 'admin' || routeViewMode === 'customer') {
        viewMode = routeViewMode;
      }
    }

    if (viewMode === 'customer' && this.router.url.includes('/administration/projects/')) {
      viewMode = 'admin';
    }

    const tab = parseProjectDetailTab(rawTab);

    return { projectId, viewMode, tab, rawTab };
  }

  private projectTabLink(projectId: string, viewMode: ProjectViewMode, tab: ProjectDetailTab): string[] {
    const prefix = viewMode === 'admin' ? '/administration/projects' : '/projects';

    return [prefix, projectId, tab];
  }
}
