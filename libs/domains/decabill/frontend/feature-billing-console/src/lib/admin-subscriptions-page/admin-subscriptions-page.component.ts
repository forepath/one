import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminBillingFacade,
  AdminBillingService,
  AdminSubscriptionsFacade,
  MetersFacade,
  SubscriptionMetersFacade,
  isSubscriptionItemDetailEligible,
  resolveServiceDisplayLabel,
  resolveSubscriptionItemProvisioningDisplayStatus,
  type AdminSubscriptionListItem,
  type CreateUsageMeterEntryDto,
  type MeterResponse,
  type SubscriptionItemResponse,
  type SubscriptionMeterSummary,
  type UsageAttachmentType,
  type UsageMeterEntryResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcModalComponent,
  FpcFormControlComponent,
  FpcFormCheckComponent,
  FpcFormFieldComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  FpcTableRowDetailDirective,
  type FpcMenuItem,
  type FpcTableColumn,
  FpcSpinnerComponent,
  FpcSummaryBarComponent,
  FpcSummaryCardComponent,
  FpcSummaryCardValueDirective,
  type FpcBadgeTone,
  FpcListHeaderComponent,
} from '@forepath/shared/frontend/ui-components';
import { filter, firstValueFrom, pairwise } from 'rxjs';

import {
  getProvisioningStatusBadgeTone,
  getProvisioningStatusLabel,
  getSubscriptionStatusBadgeTone,
  getSubscriptionStatusLabel,
  formatSubscriptionPriceCell,
  getUnavailableLabel,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { DB_DL_CANCEL, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { provisioningState, subscriptionState } from '../shared/table-states';
import { getCustomerLabel, getCustomerSecondaryLabel, type CustomerLabelSource } from '../named-label.util';
import {
  formatBillingDate,
  formatBillingDateRange,
  formatBillingDateTime,
  formatBillingMoney,
} from '../billing-format';

interface MeterEntryForm {
  meterId: string;
  value: number;
  attachmentType: UsageAttachmentType;
  addonId: string;
  periodStart: string;
  periodEnd: string;
}

interface AddonMeterOption {
  key: string;
  meterId: string;
  addonId: string;
  label: string;
}

@Component({
  selector: 'framework-admin-subscriptions-page',
  standalone: true,
  imports: [
    FpcListHeaderComponent,
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcDataTableComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
    FpcTableRowDetailDirective,
    FpcSpinnerComponent,
    FpcSummaryBarComponent,
    FpcSummaryCardComponent,
    FpcSummaryCardValueDirective,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormCheckComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcModalComponent,
  ],
  providers: [DatePipe],
  templateUrl: './admin-subscriptions-page.component.html',
  styleUrls: ['./admin-subscriptions-page.component.scss'],
})
export class AdminSubscriptionsPageComponent implements OnInit {
  readonly cancelSubscriptionModalOpen = signal(false);
  readonly withdrawSubscriptionModalOpen = signal(false);
  readonly instantCancelSubscriptionModalOpen = signal(false);
  /** Required by the API when the subscription runs a Loadweaver cluster (its data is deleted). */
  readonly confirmDataTeardown = signal(false);
  readonly resumeConfirmModalOpen = signal(false);
  readonly metersModalOpen = signal(false);
  readonly deleteEntryModalOpen = signal(false);

  readonly facade = inject(AdminSubscriptionsFacade);
  private readonly adminBillingFacade = inject(AdminBillingFacade);
  private readonly metersFacade = inject(MetersFacade);
  private readonly subscriptionMetersFacade = inject(SubscriptionMetersFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly pageTitle = $localize`:@@featureAdminSubscriptions-title:Subscriptions`;
  readonly searchPlaceholder = $localize`:@@featureAdminSubscriptions-searchPlaceholder:Search subscriptions`;

  private readonly adminBillingService = inject(AdminBillingService);
  readonly subscriptions = toSignal(this.facade.subscriptions$, { initialValue: [] as AdminSubscriptionListItem[] });
  readonly billingSummary = toSignal(this.adminBillingFacade.summary$, { initialValue: null });
  readonly billingSummaryLoading$ = this.adminBillingFacade.summaryLoading$;
  readonly summaryTotalLabel = $localize`:@@featureAdminSubscriptions-summaryTotal:Subscriptions`;
  readonly summaryActiveLabel = $localize`:@@featureAdminSubscriptions-summaryActive:Active`;
  readonly meterSummaries = toSignal(this.subscriptionMetersFacade.summaries$, {
    initialValue: [] as SubscriptionMeterSummary[],
  });
  readonly meterEntries = toSignal(this.subscriptionMetersFacade.entries$, {
    initialValue: [] as UsageMeterEntryResponse[],
  });
  readonly meterEntriesTotal = toSignal(this.subscriptionMetersFacade.entriesTotal$, { initialValue: 0 });
  readonly meterEntriesLoading = toSignal(this.subscriptionMetersFacade.loadingEntries$, { initialValue: false });
  readonly meterSummariesLoading = toSignal(this.subscriptionMetersFacade.loadingSummaries$, { initialValue: false });
  /** Meter entries paging in the usage-meter modal (built-in pager of the nested table; replace-page). */
  readonly entriesPage = signal(1);
  readonly entriesPageSize = signal(25);
  /** Subscription whose usage-meter modal is open; the paging effect loads its current entries page. */
  private readonly metersSubscriptionId = signal<string | null>(null);
  private readonly metersOpenCount = signal(0);
  private readonly loadEntriesPage = effect(() => {
    const subscriptionId = this.metersSubscriptionId();
    const page = this.entriesPage();
    const pageSize = this.entriesPageSize();

    this.metersOpenCount();

    if (subscriptionId) untracked(() => this.subscriptionMetersFacade.loadEntries(subscriptionId, page, pageSize));
  });
  readonly activeMeters = toSignal(this.metersFacade.getActiveMeters$(), { initialValue: [] as MeterResponse[] });
  readonly loading$ = this.facade.loading$;
  readonly total = toSignal(this.facade.total$, { initialValue: 0 });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  /** Search + page + page size → `GET /admin/billing/subscriptions?limit&offset&search` (replace-page). */
  readonly paging = dbServerPaging((query) => this.facade.loadSubscriptions(query));

  readonly servicesLabel = $localize`:@@featureAdminSubscriptions-services:Services`;
  readonly usageMetersLabel = $localize`:@@featureAdminSubscriptions-usageMeters:Usage meters`;
  readonly manageMetersLabel = $localize`:@@featureAdminSubscriptions-manageMetersTitle:Manage usage meters`;
  readonly withdrawLabel = $localize`:@@featureSubscriptions-withdrawButtonTitle:Withdraw subscription`;
  readonly instantCancelLabel = $localize`:@@featureAdminSubscriptions-instantCancelButtonTitle:Instant cancel subscription`;
  readonly cancelSubscriptionLabel = $localize`:@@featureSubscriptions-cancelButtonTitle:Cancel subscription`;
  readonly resumeLabel = $localize`:@@featureSubscriptions-resumeButtonTitle:Resume subscription`;

  /** Contracts: State · Contract · customer · number · period · next billing · price. */
  readonly columns: FpcTableColumn<AdminSubscriptionListItem>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminSubscriptions-colStatus:Status`,
      type: 'state',
      state: (sub) => subscriptionState(sub.status),
    },
    {
      id: 'contract',
      label: $localize`:@@featureAdminSubscriptions-colContract:Subscription`,
      value: (sub) => this.subscriptionTitle(sub),
      required: true,
      priority: 1,
    },
    {
      id: 'customer',
      label: $localize`:@@featureAdminSubscriptions-colCustomer:Customer`,
      value: (sub) => getCustomerLabel(sub),
      priority: 1,
    },
    {
      id: 'number',
      label: $localize`:@@featureAdminSubscriptions-colNumber:Number`,
      value: (sub) => sub.number ?? '',
      priority: 2,
    },
    {
      id: 'period',
      label: $localize`:@@featureAdminSubscriptions-colPeriod:Period`,
      value: (sub) => this.formatSubscriptionPeriod(sub),
      priority: 3,
    },
    {
      id: 'nextBilling',
      label: $localize`:@@featureAdminSubscriptions-colNextBilling:Next billing`,
      value: (sub) => this.formatDate(sub.nextBillingAt),
      priority: 2,
    },
    {
      id: 'price',
      label: $localize`:@@featureAdminSubscriptions-colPrice:Price`,
      value: (sub) => this.formatPeriodPrice(sub),
      align: 'end',
      priority: 2,
    },
  ];

  /** Usage meters of a contract (row detail): Meter · value · included / billable · charge. */
  readonly meterColumns: FpcTableColumn<SubscriptionMeterSummary>[] = [
    {
      id: 'meter',
      label: $localize`:@@featureAdminSubscriptions-colMeter:Meter`,
      value: (meter) => meter.name,
      required: true,
      priority: 1,
    },
    {
      id: 'value',
      label: $localize`:@@featureAdminSubscriptions-colValue:Value`,
      value: (meter) => this.formatMeterValue(meter),
      align: 'end',
      priority: 1,
    },
    {
      id: 'details',
      label: $localize`:@@featureAdminSubscriptions-colBilling:Billing`,
      value: (meter) => this.formatMeterBillingDetails(meter),
      priority: 2,
    },
    {
      id: 'charge',
      label: $localize`:@@featureAdminSubscriptions-colCharge:Estimated charge`,
      value: (meter) => this.formatMeterCharge(meter.estimatedChargeNet),
      align: 'end',
      priority: 1,
    },
  ];
  readonly meterSummariesLabel = $localize`:@@featureAdminSubscriptions-meterSummaries:Current period summaries`;
  readonly meterEntriesLabel = $localize`:@@featureAdminSubscriptions-meterEntries:Meter entries`;
  /** Meter entries of the usage-meters modal: Meter · value · type · period; ⋮ Delete; bulk Delete. */
  readonly entryColumns: FpcTableColumn<UsageMeterEntryResponse>[] = [
    {
      id: 'meter',
      label: $localize`:@@featureAdminSubscriptions-colMeter:Meter`,
      value: (entry) => this.meterNameById(entry.meterId),
      required: true,
      priority: 1,
    },
    {
      id: 'value',
      label: $localize`:@@featureAdminSubscriptions-colValue:Value`,
      value: (entry) => entry.value,
      align: 'end',
      priority: 1,
    },
    {
      id: 'type',
      label: $localize`:@@featureAdminSubscriptions-colAttachment:Attached to`,
      value: (entry) => this.attachmentTypeLabel(entry.attachmentType),
      priority: 2,
    },
    {
      id: 'period',
      label: $localize`:@@featureAdminSubscriptions-colPeriod:Period`,
      value: (entry) => entry.periodStart,
      priority: 2,
    },
  ];
  readonly deleteEntryLabel = $localize`:@@featureAdminSubscriptions-deleteEntryAction:Delete`;
  readonly dialogCancelLabel = DB_DL_CANCEL;
  readonly bulkEntryDeleteTitle = $localize`:@@featureAdminSubscriptions-bulkDeleteEntriesTitle:Delete meter entries?`;
  readonly selectedEntries = signal<readonly string[]>([]);
  readonly confirmBulkEntryDelete = signal(false);
  readonly entryBulkResult = signal<DbBulkResult | null>(null);
  readonly bulkEntryDeleteMessage = computed(
    () =>
      $localize`:@@featureAdminSubscriptions-bulkDeleteEntriesMessage:${this.selectedEntries().length}:count: selected meter entries will be deleted. This action cannot be undone.`,
  );
  readonly entryRowMenu = (): FpcMenuItem[] => [
    { id: 'delete', label: this.deleteEntryLabel, icon: 'trash', danger: true },
  ];

  readonly meterRowId = (meter: SubscriptionMeterSummary): string =>
    `${meter.meterId}:${meter.attachmentType}:${meter.addonId ?? ''}`;

  readonly expandedId = signal<string | null>(null);
  readonly selected = signal<readonly string[]>([]);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  /** True while the cancel dialog confirms the selection (bulk) instead of one contract. */
  readonly bulkCancel = signal(false);
  private readonly selectedSubscriptions = computed(() => {
    const ids = new Set(this.selected());

    return this.subscriptions().filter((sub) => ids.has(sub.id));
  });

  /** Singular wording for one contract, plural when several selected contracts are cancelled at once. */
  readonly cancelDialogCount = signal(1);
  readonly cancelDialogTitle = computed(() =>
    this.cancelDialogCount() > 1
      ? $localize`:@@featureAdminSubscriptions-bulkCancelTitle:Cancel subscriptions?`
      : $localize`:@@featureSubscriptions-cancelSubscriptionTitle:Cancel subscription?`,
  );
  readonly cancelDialogMessage = computed(() =>
    this.cancelDialogCount() > 1
      ? $localize`:@@featureAdminSubscriptions-bulkCancelMessage:Cancel ${this.cancelDialogCount()}:count: selected subscriptions? Each remains active until the end of its current period.`
      : $localize`:@@featureSubscriptions-cancelSubscriptionConfirm:Are you sure you want to cancel this subscription? It will remain active until the end of the current period.`,
  );

  readonly rowMenu = (sub: AdminSubscriptionListItem): FpcMenuItem[] => [
    { id: 'meters', label: this.manageMetersLabel, icon: 'speedometer2' },
    ...(sub.withdrawalEligibility?.canWithdraw
      ? [{ id: 'withdraw', label: this.withdrawLabel, icon: 'box-arrow-left', dividerBefore: true }]
      : []),
    ...(this.canInstantCancel(sub)
      ? [{ id: 'instant-cancel', label: this.instantCancelLabel, icon: 'lightning-charge', danger: true }]
      : []),
    ...(sub.status === 'active'
      ? [{ id: 'cancel', label: this.cancelSubscriptionLabel, icon: 'x-circle', danger: true }]
      : []),
    ...(sub.status === 'pending_cancel'
      ? [{ id: 'resume', label: this.resumeLabel, icon: 'arrow-counterclockwise' }]
      : []),
    dbCopyIdItem(),
  ];
  readonly canceling$ = this.facade.canceling$;
  readonly withdrawing$ = this.facade.withdrawing$;
  readonly instantCanceling$ = this.facade.instantCanceling$;
  readonly resuming$ = this.facade.resuming$;
  readonly error$ = this.facade.error$;
  readonly metersError$ = this.subscriptionMetersFacade.error$;
  readonly creatingEntry$ = this.subscriptionMetersFacade.creating$;
  readonly deletingEntry$ = this.subscriptionMetersFacade.deleting$;

  subscriptionToCancel: AdminSubscriptionListItem | null = null;
  subscriptionToWithdraw: AdminSubscriptionListItem | null = null;
  subscriptionToInstantCancel: AdminSubscriptionListItem | null = null;
  subscriptionToResume: AdminSubscriptionListItem | null = null;
  subscriptionForMeters: AdminSubscriptionListItem | null = null;
  entryToDelete: UsageMeterEntryResponse | null = null;
  entryForm: MeterEntryForm = this.defaultEntryForm();
  selectedAddonMeterKey = '';

  customerLabel(row: CustomerLabelSource): string {
    return getCustomerLabel(row);
  }

  customerTitle(row: CustomerLabelSource): string | null {
    return getCustomerSecondaryLabel(row);
  }

  ngOnInit(): void {
    this.adminBillingFacade.loadSummary();
    this.metersFacade.loadMeters();
    this.registerModalCloseWatchers();

    this.creatingEntry$
      .pipe(
        pairwise(),
        filter(([previous, current]) => previous === true && current === false),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.entryForm = this.defaultEntryForm();
        this.selectedAddonMeterKey = '';
      });
  }

  toggleExpanded(sub: AdminSubscriptionListItem): void {
    this.expandedId.update((id) => (id === sub.id ? null : sub.id));
  }

  onRowAction(sub: AdminSubscriptionListItem, action: string): void {
    if (action === 'meters') this.openMetersModal(sub);
    else if (action === 'withdraw') this.openWithdrawConfirm(sub);
    else if (action === 'instant-cancel') this.openInstantCancelConfirm(sub);
    else if (action === 'cancel') this.openCancelConfirm(sub);
    else if (action === 'resume') this.openResumeConfirm(sub);
    else if (action === 'copy-id') fpcCopyText(sub.id);
  }

  selectedWithStatus(status: string): AdminSubscriptionListItem[] {
    return this.selectedSubscriptions().filter((sub) => sub.status === status);
  }

  openBulkCancelConfirm(): void {
    this.bulkCancel.set(true);
    this.cancelDialogCount.set(this.selectedWithStatus('active').length);
    this.subscriptionToCancel = null;
    this.confirmDataTeardown.set(false);
    showBillingModal(this.cancelSubscriptionModalOpen);
  }

  /** Bulk Cancel: one `POST …/subscriptions/:id/cancel` per active contract (same teardown confirmation for all). */
  async cancelSelected(): Promise<void> {
    const targets = this.selectedWithStatus('active');
    const options = { confirmDataTeardown: this.confirmDataTeardown() };

    this.bulkCancel.set(false);
    this.cancelSubscriptionModalOpen.set(false);

    if (targets.length === 0) return;

    const result = await fpcRunBulk(targets, (sub) =>
      firstValueFrom(this.adminBillingService.cancelSubscription(sub.id, options)),
    );

    this.finishBulk(dbBulkSummary(result, (sub) => this.subscriptionTitle(sub)));
  }

  /** Bulk Resume: one `POST …/subscriptions/:id/resume` per contract pending cancellation. */
  async resumeSelected(): Promise<void> {
    const targets = this.selectedWithStatus('pending_cancel');

    if (targets.length === 0) return;

    const result = await fpcRunBulk(targets, (sub) =>
      firstValueFrom(this.adminBillingService.resumeSubscription(sub.id)),
    );

    this.finishBulk(dbBulkSummary(result, (sub) => this.subscriptionTitle(sub)));
  }

  /** Columns per contract (cached: the row detail re-renders on every check). */
  serviceColumns(sub: AdminSubscriptionListItem): FpcTableColumn<SubscriptionItemResponse>[] {
    let columns = this.serviceColumnsCache.get(sub);

    if (!columns) {
      columns = this.buildServiceColumns(sub);
      this.serviceColumnsCache.set(sub, columns);
    }

    return columns;
  }

  private buildServiceColumns(sub: AdminSubscriptionListItem): FpcTableColumn<SubscriptionItemResponse>[] {
    return [
      {
        id: 'state',
        label: $localize`:@@featureAdminSubscriptions-colProvisioning:Provisioning`,
        type: 'state',
        state: (item) => provisioningState(resolveSubscriptionItemProvisioningDisplayStatus(item, sub.status)),
      },
      {
        id: 'service',
        label: $localize`:@@featureAdminSubscriptions-colService:Service`,
        value: (item) => this.serviceDisplayLabel(item),
        required: true,
        priority: 1,
      },
    ];
  }

  serviceLinkFor(sub: AdminSubscriptionListItem): (item: SubscriptionItemResponse) => string | null {
    let link = this.serviceLinkCache.get(sub);

    if (!link) {
      link = (item) => (this.isServiceDetailEligible(sub, item) ? this.serviceDetailLink(sub, item).join('/') : null);
      this.serviceLinkCache.set(sub, link);
    }

    return link;
  }

  private readonly serviceColumnsCache = new WeakMap<
    AdminSubscriptionListItem,
    FpcTableColumn<SubscriptionItemResponse>[]
  >();
  private readonly serviceLinkCache = new WeakMap<
    AdminSubscriptionListItem,
    (item: SubscriptionItemResponse) => string | null
  >();

  private finishBulk(result: DbBulkResult): void {
    this.bulkResult.set(result);
    this.selected.set([]);
    this.paging.reload();
  }

  openMetersModal(sub: AdminSubscriptionListItem): void {
    this.subscriptionForMeters = sub;
    this.entryForm = this.defaultEntryForm();
    this.selectedAddonMeterKey = '';
    this.selectedEntries.set([]);
    this.entryBulkResult.set(null);
    this.subscriptionMetersFacade.loadSummaries(sub.id);
    // Entries: page 1 via the paging effect.
    this.entriesPage.set(1);
    this.metersSubscriptionId.set(sub.id);
    this.metersOpenCount.update((count) => count + 1);
    showBillingModal(this.metersModalOpen);
  }

  submitMeterEntry(): void {
    if (!this.subscriptionForMeters || !this.entryForm.meterId || this.entryForm.value < 0) return;

    if (this.entryForm.attachmentType === 'addon' && !this.entryForm.addonId) return;

    const dto: CreateUsageMeterEntryDto = {
      meterId: this.entryForm.meterId,
      value: Number(this.entryForm.value) || 0,
      attachmentType: this.entryForm.attachmentType,
      addonId: this.entryForm.attachmentType === 'addon' ? this.entryForm.addonId : undefined,
      periodStart: new Date(this.entryForm.periodStart).toISOString(),
      periodEnd: new Date(this.entryForm.periodEnd).toISOString(),
    };

    this.subscriptionMetersFacade.createEntry(this.subscriptionForMeters.id, dto);
  }

  openDeleteEntryConfirm(entry: UsageMeterEntryResponse): void {
    this.entryToDelete = entry;
    showBillingModal(this.deleteEntryModalOpen);
  }

  onEntryAction(entry: UsageMeterEntryResponse, action: string): void {
    if (action === 'delete') this.openDeleteEntryConfirm(entry);
  }

  entryPeriodLabel(entry: UsageMeterEntryResponse): string {
    return `${this.formatDateTime(entry.periodStart)} → ${this.formatDateTime(entry.periodEnd)}`;
  }

  /** Bulk Delete of meter entries: one `DELETE /admin/billing/subscriptions/:id/meter-entries/:entryId` per entry. */
  async deleteSelectedEntries(): Promise<void> {
    const sub = this.subscriptionForMeters;
    const ids = new Set(this.selectedEntries());
    const entries = this.meterEntries().filter((entry) => ids.has(entry.id));

    if (!sub || entries.length === 0) return;

    const result = await fpcRunBulk(entries, (entry) =>
      firstValueFrom(this.adminBillingService.deleteSubscriptionMeterEntry(sub.id, entry.id)),
    );

    this.entryBulkResult.set(
      dbBulkSummary(
        result,
        (entry) => `${this.meterNameById(entry.meterId)} (${this.formatDateTime(entry.periodStart)})`,
      ),
    );
    this.selectedEntries.set([]);
    // Summaries + the current entries page (replace-page, no append).
    this.subscriptionMetersFacade.loadAll(sub.id, this.entriesPage(), this.entriesPageSize());
  }

  confirmDeleteEntry(): void {
    if (!this.subscriptionForMeters || !this.entryToDelete) return;

    this.subscriptionMetersFacade.deleteEntry(this.subscriptionForMeters.id, this.entryToDelete.id);
  }

  subscriptionMeterSummaries(sub: AdminSubscriptionListItem): SubscriptionMeterSummary[] {
    return sub.meters ?? [];
  }

  subscriptionItems(sub: AdminSubscriptionListItem): SubscriptionItemResponse[] {
    return sub.items ?? [];
  }

  serviceDisplayLabel(item: SubscriptionItemResponse): string {
    return resolveServiceDisplayLabel(item);
  }

  isServiceDetailEligible(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): boolean {
    return isSubscriptionItemDetailEligible(item, sub.status);
  }

  itemProvisioningStatusLabel(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): string {
    return getProvisioningStatusLabel(resolveSubscriptionItemProvisioningDisplayStatus(item, sub.status));
  }

  itemProvisioningStatusBadgeTone(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): FpcBadgeTone {
    return getProvisioningStatusBadgeTone(resolveSubscriptionItemProvisioningDisplayStatus(item, sub.status));
  }

  serviceDetailLink(sub: AdminSubscriptionListItem, item: SubscriptionItemResponse): string[] {
    return ['/administration', 'subscriptions', sub.id, 'services', item.id];
  }

  hasSubscriptionMeters(sub: AdminSubscriptionListItem): boolean {
    return this.subscriptionMeterSummaries(sub).length > 0;
  }

  meterNameById(meterId: string): string {
    return resolveNamedLabel(this.activeMeters().find((meter) => meter.id === meterId)?.name);
  }

  formatMeterCharge(amount: number): string {
    return formatBillingMoney(amount);
  }

  formatMeterValue(summary: SubscriptionMeterSummary): string {
    const unit = summary.unitLabel ? ` ${summary.unitLabel}` : '';

    return `${summary.aggregatedValue}${unit}`;
  }

  formatMeterBillingDetails(summary: SubscriptionMeterSummary): string {
    const unit = summary.unitLabel ? ` ${summary.unitLabel}` : '';
    const parts: string[] = [];

    if (summary.effectiveIncludedUsage > 0) {
      parts.push(
        $localize`:@@featureAdminSubscriptions-meterIncludedAllowance:${summary.effectiveIncludedUsage}${unit}:value: included`,
      );
    }

    if (summary.billableValue !== summary.aggregatedValue) {
      parts.push(
        $localize`:@@featureAdminSubscriptions-meterBillableValue:${summary.billableValue}${unit}:value: billable`,
      );
    }

    return parts.join(', ');
  }

  attachmentTypeLabel(type: UsageAttachmentType): string {
    return type === 'addon'
      ? $localize`:@@featureAdminSubscriptions-attachmentAddon:Add-on`
      : $localize`:@@featureAdminSubscriptions-attachmentPlan:Plan`;
  }

  availableAddonMeters(): AddonMeterOption[] {
    return this.meterSummaries()
      .filter((summary) => summary.attachmentType === 'addon' && !!summary.addonId?.trim())
      .map((summary) => {
        const addonId = summary.addonId!.trim();
        const addonName = summary.addonName?.trim();

        return {
          key: `${summary.meterId}|${addonId}`,
          meterId: summary.meterId,
          addonId,
          label: addonName ? `${summary.name} (${addonName})` : summary.name,
        };
      });
  }

  hasAvailableAddonMeters(): boolean {
    return this.availableAddonMeters().length > 0;
  }

  onAttachmentTypeChange(): void {
    if (this.entryForm.attachmentType === 'addon' && !this.hasAvailableAddonMeters()) {
      this.entryForm.attachmentType = 'plan';
    }

    this.entryForm.meterId = '';
    this.entryForm.addonId = '';
    this.selectedAddonMeterKey = '';
  }

  onAddonMeterChange(): void {
    const selected = this.availableAddonMeters().find((option) => option.key === this.selectedAddonMeterKey);

    this.entryForm.meterId = selected?.meterId ?? '';
    this.entryForm.addonId = selected?.addonId ?? '';
  }

  openCancelConfirm(sub: AdminSubscriptionListItem): void {
    this.bulkCancel.set(false);
    this.cancelDialogCount.set(1);
    this.subscriptionToCancel = sub;
    this.confirmDataTeardown.set(false);
    showBillingModal(this.cancelSubscriptionModalOpen);
  }

  confirmCancelSubscription(): void {
    if (!this.subscriptionToCancel) return;

    this.facade.cancelSubscription(this.subscriptionToCancel.id, { confirmDataTeardown: this.confirmDataTeardown() });
  }

  openWithdrawConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToWithdraw = sub;
    this.confirmDataTeardown.set(false);
    showBillingModal(this.withdrawSubscriptionModalOpen);
  }

  confirmWithdrawSubscription(): void {
    if (!this.subscriptionToWithdraw) return;

    this.facade.withdrawSubscription(this.subscriptionToWithdraw.id, {
      confirmDataTeardown: this.confirmDataTeardown(),
    });
  }

  canInstantCancel(sub: AdminSubscriptionListItem): boolean {
    return sub.status === 'active' || sub.status === 'pending_cancel' || sub.status === 'pending_backorder';
  }

  openInstantCancelConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToInstantCancel = sub;
    this.confirmDataTeardown.set(false);
    showBillingModal(this.instantCancelSubscriptionModalOpen);
  }

  confirmInstantCancelSubscription(): void {
    if (!this.subscriptionToInstantCancel) return;

    this.facade.instantCancelSubscription(this.subscriptionToInstantCancel.id, {
      confirmDataTeardown: this.confirmDataTeardown(),
    });
  }

  openResumeConfirm(sub: AdminSubscriptionListItem): void {
    this.subscriptionToResume = sub;
    showBillingModal(this.resumeConfirmModalOpen);
  }

  confirmResume(): void {
    if (!this.subscriptionToResume) return;

    this.facade.resumeSubscription(this.subscriptionToResume.id);
  }

  subscriptionTitle(sub: AdminSubscriptionListItem): string {
    return resolveNamedLabel(sub.planName);
  }

  subscriptionUserLabel(sub: AdminSubscriptionListItem): string {
    const email = sub.userEmail?.trim();

    if (email) return email;

    return getUnavailableLabel();
  }

  subscriptionStatusLabel(status: string | null | undefined): string {
    return getSubscriptionStatusLabel(status);
  }

  subscriptionStatusBadgeTone(status: string | null | undefined): FpcBadgeTone {
    return getSubscriptionStatusBadgeTone(status);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return '-';

    return formatBillingDate(value, '-');
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) return '-';

    return formatBillingDateTime(value, '-');
  }

  formatSubscriptionPeriod(sub: AdminSubscriptionListItem): string {
    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) return '-';

    return formatBillingDateRange(sub.currentPeriodStart, sub.currentPeriodEnd);
  }

  formatPeriodPrice(sub: AdminSubscriptionListItem): string {
    return formatSubscriptionPriceCell(
      sub.periodTotalPrice,
      { value: sub.billingIntervalValue, type: sub.billingIntervalType },
      (sub.meters?.length ?? 0) > 0,
      (amount) => formatBillingMoney(amount),
    );
  }

  formatCurrencyAmount(amount: number): string {
    return formatBillingMoney(amount);
  }

  private defaultEntryForm(): MeterEntryForm {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return {
      meterId: '',
      value: 0,
      attachmentType: 'plan',
      addonId: '',
      periodStart: this.toDateTimeLocal(start),
      periodEnd: this.toDateTimeLocal(end),
    };
  }

  private toDateTimeLocal(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private registerModalCloseWatchers(): void {
    watchBillingMutationModalClose({
      loading$: this.canceling$,
      error$: this.error$,
      open: this.cancelSubscriptionModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.withdrawing$,
      error$: this.error$,
      open: this.withdrawSubscriptionModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToWithdraw = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.instantCanceling$,
      error$: this.error$,
      open: this.instantCancelSubscriptionModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToInstantCancel = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.resuming$,
      error$: this.error$,
      open: this.resumeConfirmModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.subscriptionToResume = null;
      },
    });
    watchBillingMutationModalClose({
      loading$: this.deletingEntry$,
      error$: this.metersError$,
      open: this.deleteEntryModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.entryToDelete = null;
      },
    });
  }
}
