import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterModule } from '@angular/router';
import {
  AdminBillingService,
  AdminProjectsService,
  ProjectBoardSocketFacade,
  ProjectTimeEntriesFacade,
  ProjectsFacade,
  type AdminProjectDetailResponse,
  type BillProjectTimeDto,
  type ManualInvoiceLineItemDto,
  type ProjectSummaryResponse,
  type ProjectTimeEntryResponse,
  type SubscriptionResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { filter, finalize, map, startWith, switchMap, distinctUntilChanged, EMPTY, take } from 'rxjs';
import type { Subscription } from 'rxjs';

import { BillingAdminSubscriptionSelectComponent } from '../billing-admin-subscription-select/billing-admin-subscription-select.component';
import { hideBillingModal, showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import {
  getProjectTimeEntryBillingStatusIconClass,
  getProjectTimeEntryBillingStatusLabel,
  getProjectTimeEntryBillingStatusTextClass,
  isProjectTimeEntryBilled,
} from '../billing-status-labels';
import { ProjectBoardComponent } from '../project-board/project-board.component';
import { ProjectMilestonesPanelComponent } from '../project-milestones-panel/project-milestones-panel.component';
import {
  computeProjectMilestonesCompleteProgress,
  computeProjectOpenDoneProgress,
  computeProjectTargetHoursProgress,
  computeProjectTicketsDoneProgress,
  formatProjectTargetHoursDuration,
  hasProjectTargetHours,
  type ProjectSummaryProgressBar,
} from '../project-summary-progress.utils';
import { parseProjectDetailTab, type ProjectDetailTab } from './project-detail-tabs';

type ProjectViewMode = 'admin' | 'customer';

interface BillTimeFormLineItem extends ManualInvoiceLineItemDto {
  taxCategory: 'standard' | 'reduced';
}

@Component({
  selector: 'framework-project-detail-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ProjectBoardComponent,
    ProjectMilestonesPanelComponent,
    BillingAdminSubscriptionSelectComponent,
  ],
  templateUrl: './project-detail-page.component.html',
  styleUrls: ['./project-detail-page.component.scss'],
})
export class ProjectDetailPageComponent implements OnInit {
  @ViewChild('createTimeModal', { static: false }) private createTimeModal!: ElementRef<HTMLDivElement>;
  @ViewChild('editTimeModal', { static: false }) private editTimeModal!: ElementRef<HTMLDivElement>;
  @ViewChild('deleteTimeModal', { static: false }) private deleteTimeModal!: ElementRef<HTMLDivElement>;
  @ViewChild('billTimeModal', { static: false }) private billTimeModal!: ElementRef<HTMLDivElement>;
  @ViewChild('timeReportModal', { static: false }) private timeReportModal!: ElementRef<HTMLDivElement>;
  @ViewChild('billTimeSubscriptionSelect')
  private billTimeSubscriptionSelect?: BillingAdminSubscriptionSelectComponent;

  protected readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsFacade = inject(ProjectsFacade);
  private readonly adminProjectsService = inject(AdminProjectsService);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly timeEntriesFacade = inject(ProjectTimeEntriesFacade);
  private readonly socketFacade = inject(ProjectBoardSocketFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isAdminView = signal(false);
  readonly trackedTimeProgressAriaLabel = $localize`:@@featureProjectDetail-trackedTimeProgressAria:Tracked time progress`;

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

  billFormFrom = '';
  billFormTo = '';
  timeReportFormFrom = '';
  timeReportFormTo = '';
  timeReportUnbilledOnly = false;
  readonly timeReportSaving = signal(false);
  readonly timeReportError = signal<string | null>(null);
  readonly timeReportBoundsLoading = signal(false);
  billSubscriptionId = '';
  billCustomLineItems: BillTimeFormLineItem[] = [];
  readonly billBoundsLoading = signal(false);
  readonly billBoundsEntryCount = signal(0);
  readonly billTimeSubscriptions = signal<SubscriptionResponse[]>([]);
  readonly billTimeSubscriptionsLoading = signal(false);
  readonly taxCategoryOptions: { value: BillTimeFormLineItem['taxCategory']; label: string }[] = [
    { value: 'standard', label: 'Standard (19%)' },
    { value: 'reduced', label: 'Reduced (7%)' },
  ];
  private billTimeSubscriptionsRequest?: Subscription;

  ngOnInit(): void {
    this.resetTimeForm();
    this.registerTimeEntryModalCloseWatchers();
    this.registerBillTimeModalCloseWatcher();

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

  openBillTimeModal(): void {
    if (!this.projectId || !this.isAdminView()) return;

    this.summary$.pipe(take(1)).subscribe((summary) => {
      if (!this.hasUnbilledTime(summary)) return;

      this.openBillTimeModalAfterSummaryCheck();
    });
  }

  private openBillTimeModalAfterSummaryCheck(): void {
    if (!this.projectId) return;

    this.projectsFacade.clearError();
    this.resetBillTimeCustomFields();
    this.billBoundsLoading.set(true);
    this.billBoundsEntryCount.set(0);

    this.selectedProject$.pipe(take(1)).subscribe((project) => {
      const userId = (project as AdminProjectDetailResponse | null)?.userId;

      if (userId) {
        this.loadBillTimeSubscriptions(userId);
      }
    });

    this.adminProjectsService.getUnbilledTimeBounds(this.projectId).subscribe({
      next: (bounds) => {
        this.billBoundsEntryCount.set(bounds.entryCount);

        if (bounds.from && bounds.to) {
          this.billFormFrom = this.toDatetimeLocalValue(new Date(bounds.from));
          this.billFormTo = this.toDatetimeLocalValue(new Date(bounds.to));
        } else {
          this.billFormFrom = '';
          this.billFormTo = '';
        }

        this.billBoundsLoading.set(false);
        showBillingModal(this.billTimeModal);
        queueMicrotask(() => this.billTimeSubscriptionSelect?.reset());
      },
      error: () => {
        this.billBoundsLoading.set(false);
      },
    });
  }

  openTimeReportModal(): void {
    if (!this.projectId || !this.isAdminView()) return;

    this.timeReportError.set(null);
    this.timeReportUnbilledOnly = false;
    this.timeReportBoundsLoading.set(true);

    this.adminProjectsService.getUnbilledTimeBounds(this.projectId).subscribe({
      next: (bounds) => {
        if (bounds.from && bounds.to) {
          this.timeReportFormFrom = this.toDatetimeLocalValue(new Date(bounds.from));
          this.timeReportFormTo = this.toDatetimeLocalValue(new Date(bounds.to));
        } else {
          this.timeReportFormFrom = '';
          this.timeReportFormTo = '';
        }

        this.timeReportBoundsLoading.set(false);
        showBillingModal(this.timeReportModal);
      },
      error: () => {
        this.timeReportBoundsLoading.set(false);
      },
    });
  }

  submitTimeReport(): void {
    if (!this.projectId || !this.isAdminView() || !this.isTimeReportFormValid() || this.timeReportSaving()) {
      return;
    }

    this.timeReportSaving.set(true);
    this.timeReportError.set(null);

    this.adminProjectsService
      .generateTimeReport(this.projectId, {
        from: this.datetimeLocalToIso(this.timeReportFormFrom),
        to: this.datetimeLocalToIso(this.timeReportFormTo),
        unbilledOnly: this.timeReportUnbilledOnly,
      })
      .pipe(finalize(() => this.timeReportSaving.set(false)))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');

          anchor.href = url;
          anchor.download = `time-report-${this.projectId}.pdf`;
          anchor.click();
          URL.revokeObjectURL(url);
          hideBillingModal(this.timeReportModal);
        },
        error: () => {
          this.timeReportError.set('Failed to generate time report');
        },
      });
  }

  isTimeReportFormValid(): boolean {
    if (!this.timeReportFormFrom || !this.timeReportFormTo) return false;

    return new Date(this.timeReportFormTo).getTime() > new Date(this.timeReportFormFrom).getTime();
  }

  submitBillTime(): void {
    if (
      !this.projectId ||
      !this.isAdminView() ||
      !this.isBillTimeFormValid() ||
      this.billBoundsEntryCount() === 0 ||
      !this.hasValidBillTimeCustomLineItems()
    ) {
      return;
    }

    const dto: BillProjectTimeDto = {
      from: this.datetimeLocalToIso(this.billFormFrom),
      to: this.datetimeLocalToIso(this.billFormTo),
      subscriptionId: this.billSubscriptionId.trim() || undefined,
    };

    if (this.billCustomLineItems.length > 0) {
      dto.lineItems = this.billCustomLineItems.map((line) => ({
        description: line.description.trim(),
        quantity: line.quantity,
        unitPriceNet: line.unitPriceNet,
        taxCategory: line.taxCategory,
      }));
    }

    this.projectsFacade.billProjectTime(this.projectId, dto);
  }

  formatBillTimeLineTotal(line: BillTimeFormLineItem): string {
    const quantity = Number(line.quantity);
    const unitPriceNet = Number(line.unitPriceNet);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceNet) || unitPriceNet < 0) {
      return '—';
    }

    const net = Math.round(quantity * unitPriceNet * 100) / 100;
    const taxRate = line.taxCategory === 'reduced' ? 7 : 19;
    const tax = Math.round(net * (taxRate / 100) * 100) / 100;
    const gross = Math.round((net + tax) * 100) / 100;

    return `€${gross.toFixed(2)} gross (${taxRate}% VAT)`;
  }

  addBillTimeLineItem(): void {
    this.billCustomLineItems = [...this.billCustomLineItems, this.emptyBillTimeLineItem()];
  }

  removeBillTimeLineItem(index: number): void {
    this.billCustomLineItems = this.billCustomLineItems.filter((_, itemIndex) => itemIndex !== index);
  }

  isBillTimeFormValid(): boolean {
    if (!this.billFormFrom || !this.billFormTo) return false;

    return new Date(this.billFormTo).getTime() > new Date(this.billFormFrom).getTime();
  }

  hasValidBillTimeCustomLineItems(): boolean {
    return (
      this.billCustomLineItems.length === 0 ||
      this.billCustomLineItems.every(
        (item) => item.description.trim().length > 0 && item.quantity > 0 && item.unitPriceNet >= 0,
      )
    );
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

  hasUnbilledTime(summary: ProjectSummaryResponse | null | undefined): boolean {
    return !!summary && summary.unbilledMinutes > 0;
  }

  hasTargetHours(targetHours: number | null | undefined): boolean {
    return hasProjectTargetHours(targetHours);
  }

  formatTargetHoursDuration(targetHours: number | null | undefined): string {
    return hasProjectTargetHours(targetHours) ? formatProjectTargetHoursDuration(targetHours) : '';
  }

  trackedTimeTargetAriaLabel(trackedMinutes: number, targetHours: number | null | undefined): string {
    return `${this.formatMinutes(trackedMinutes)} / ${this.formatTargetHoursDuration(targetHours)}`;
  }

  targetHoursProgress(trackedMinutes: number, targetHours: number | null | undefined): ProjectSummaryProgressBar {
    return computeProjectTargetHoursProgress(trackedMinutes, targetHours);
  }

  ticketsDoneProgress(summary: ProjectSummaryResponse): ProjectSummaryProgressBar {
    if (this.isAdminView()) {
      return computeProjectOpenDoneProgress(summary.openTicketCount, summary.doneTicketCount);
    }

    return computeProjectTicketsDoneProgress(summary.openTicketCount, summary.doneTicketCount);
  }

  milestonesCompleteProgress(summary: ProjectSummaryResponse): ProjectSummaryProgressBar {
    if (this.isAdminView()) {
      return computeProjectOpenDoneProgress(summary.openMilestoneCount, this.completedMilestoneCount(summary));
    }

    return computeProjectMilestonesCompleteProgress(summary.openMilestoneCount, summary.milestoneCount);
  }

  hasOpenDoneSplit(progress: ProjectSummaryProgressBar): boolean {
    return progress.openPct != null;
  }

  totalTicketCount(summary: ProjectSummaryResponse): number {
    return summary.openTicketCount + summary.doneTicketCount;
  }

  completedMilestoneCount(summary: ProjectSummaryResponse): number {
    return summary.milestoneCount - summary.openMilestoneCount;
  }

  milestoneSummaryPrimaryCount(summary: ProjectSummaryResponse): number {
    return this.isAdminView() ? summary.openMilestoneCount : this.completedMilestoneCount(summary);
  }

  ticketSummaryPrimaryCount(summary: ProjectSummaryResponse): number {
    return this.isAdminView() ? summary.openTicketCount : summary.doneTicketCount;
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

  private registerBillTimeModalCloseWatcher(): void {
    watchBillingMutationModalClose({
      loading$: this.billing$,
      error$: this.error$,
      modal: () => this.billTimeModal,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.resetBillTimeCustomFields();

        if (this.projectId && this.activeTab() === 'time') {
          this.timeEntriesFacade.load(this.projectId);
        }
      },
    });
  }

  private resetBillTimeCustomFields(): void {
    this.billSubscriptionId = '';
    this.billCustomLineItems = [];
    this.billTimeSubscriptions.set([]);
    this.billTimeSubscriptionsLoading.set(false);
    this.billTimeSubscriptionsRequest?.unsubscribe();
    this.billTimeSubscriptionsRequest = undefined;
  }

  private emptyBillTimeLineItem(): BillTimeFormLineItem {
    return { description: '', quantity: 1, unitPriceNet: 0, taxCategory: 'standard' };
  }

  private loadBillTimeSubscriptions(userId: string): void {
    this.billTimeSubscriptionsRequest?.unsubscribe();
    this.billTimeSubscriptionsLoading.set(true);
    this.billTimeSubscriptionsRequest = this.adminBillingService
      .listUserSubscriptions(userId, { limit: 100 })
      .pipe(finalize(() => this.billTimeSubscriptionsLoading.set(false)))
      .subscribe({
        next: (subscriptions) => this.billTimeSubscriptions.set(subscriptions),
        error: () => this.billTimeSubscriptions.set([]),
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
