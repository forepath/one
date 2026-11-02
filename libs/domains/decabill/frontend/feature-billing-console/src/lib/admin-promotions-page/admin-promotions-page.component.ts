import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminPromotionsFacade,
  AdminPromotionsService,
  ServicePlansFacade,
  ServiceTypesFacade,
  type AdminPromotionResponse,
  type CreateAdminPromotionDto,
  type PromotionAdvantageType,
  type PromotionRedemptionResponse,
  type PromotionSubscriptionEligibility,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcMultiSelectComponent,
  FpcPageHeaderComponent,
  fpcRunBulk,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcMultiSelectOption,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, firstValueFrom, map } from 'rxjs';

import {
  getPromotionFreeDaysLabel,
  getPromotionFreePeriodsLabel,
  getPromotionRedemptionContextLabel,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';
import { BILLING_MULTI_SELECT_LABELS } from '../billing-multi-select';
import { DB_DL_CANCEL, dbBulkSummary, dbCopyIdItem, type DbBulkResult } from '../shared/data-list';
import { dbServerPaging } from '../shared/server-paging';
import { activeState, redemptionState } from '../shared/table-states';
import { formatBillingDateRange, formatBillingDateTime, formatBillingMoney } from '../billing-format';

@Component({
  selector: 'framework-admin-promotions-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcMultiSelectComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcTableCellDirective,
  ],
  providers: [DatePipe],
  templateUrl: './admin-promotions-page.component.html',
  styleUrls: ['./admin-promotions-page.component.scss'],
})
export class AdminPromotionsPageComponent implements OnInit {
  readonly createModalOpen = signal(false);
  readonly editModalOpen = signal(false);
  readonly redemptionsModalOpen = signal(false);

  readonly pageTitle = $localize`:@@featureAdminPromotions-pageTitle:Promotions`;
  readonly createPromotionAriaLabel = $localize`:@@featureAdminPromotions-create:Create promotion`;
  readonly searchPlaceholder = $localize`:@@featureAdminPromotions-searchPlaceholder:Search promotions`;

  private readonly facade = inject(AdminPromotionsFacade);
  private readonly promotionsService = inject(AdminPromotionsService);
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  /** Search + page + size → `GET /admin/billing/promotions?limit&offset&search` (replace-page; URL `q` / `p` / `n`). */
  readonly paging = dbServerPaging(
    (query) => this.facade.loadPromotions({ search: query.search, page: query.page, pageSize: query.pageSize }),
    { url: '' },
  );
  readonly promotions = toSignal(this.facade.getPromotions$(), { initialValue: [] as AdminPromotionResponse[] });
  readonly total = toSignal(this.facade.getTotal$(), { initialValue: 0 });
  readonly loading$ = this.facade.getLoading$();
  readonly creating$ = this.facade.getCreating$();
  readonly updating$ = this.facade.getUpdating$();
  readonly deactivating$ = this.facade.getDeactivating$();
  readonly loadingAny$ = combineLatest([this.creating$, this.updating$, this.deactivating$]).pipe(
    map(([creating, updating, deactivating]) => creating || updating || deactivating),
  );
  readonly error$ = this.facade.getError$();
  readonly redemptions = toSignal(this.facade.getRedemptions$(), {
    initialValue: [] as PromotionRedemptionResponse[],
  });
  readonly redemptionsLoading$ = this.facade.getRedemptionsLoading$();
  readonly redemptionsTotal = toSignal(this.facade.getRedemptionsTotal$(), { initialValue: 0 });
  /** Redemptions of the selected promotion: built-in pager of the nested table (replace-page). */
  readonly redemptionsPromotionId = signal<string | null>(null);
  readonly redemptionsPage = signal(1);
  readonly redemptionsPageSize = signal(25);
  private readonly redemptionsOpenCount = signal(0);
  readonly servicePlans$ = combineLatest([
    this.servicePlansFacade.getServicePlans$(),
    this.serviceTypesFacade.getServiceTypes$(),
  ]).pipe(map(([plans, types]) => ({ plans, types })));
  /** Applicable-plan options of the shared multi-select (DB-08): plan name, service type as hint (catalog order). */
  readonly planOptions$ = this.servicePlans$.pipe(map(({ plans, types }) => promotionPlanOptions(plans, types)));
  readonly multiSelectSearchLabel = BILLING_MULTI_SELECT_LABELS.search;
  readonly multiSelectRemoveLabel = BILLING_MULTI_SELECT_LABELS.remove;
  readonly multiSelectEmptyLabel = BILLING_MULTI_SELECT_LABELS.empty;

  readonly columns: FpcTableColumn<AdminPromotionResponse>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminPromotions-colStatus:Status`,
      type: 'state',
      state: (promotion) => activeState(promotion.isActive),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminPromotions-colPromotion:Promotion`,
      value: (promotion) => promotion.name,
      required: true,
      priority: 1,
    },
    {
      id: 'code',
      label: $localize`:@@featureAdminPromotions-colCode:Code`,
      value: (promotion) => promotion.code,
      mono: true,
      priority: 1,
    },
    {
      id: 'period',
      label: $localize`:@@featureAdminPromotions-colPeriod:Redeemable`,
      value: (promotion) => promotion.redeemableFrom,
      priority: 2,
    },
    {
      id: 'advantage',
      label: $localize`:@@featureAdminPromotions-colAdvantage:Advantage`,
      value: (promotion) => this.advantageSummaryLabel(promotion),
      priority: 2,
    },
    {
      id: 'eligibility',
      label: $localize`:@@featureAdminPromotions-colEligibility:Subscription eligibility`,
      value: (promotion) => this.eligibilityLabel(promotion.subscriptionEligibility),
      priority: 3,
      // DB-02: low-value wide column off by default (column chooser) so the list fits 1440 px with ⋮ visible.
      hidden: true,
    },
    {
      id: 'redemptions',
      label: $localize`:@@featureAdminPromotions-redemptions:Redemptions`,
      value: (promotion) => promotion.redemptionCount,
      align: 'end',
      priority: 3,
    },
  ];

  readonly redemptionsTitle = $localize`:@@featureAdminPromotions-redemptions:Redemptions`;
  readonly redemptionColumns: FpcTableColumn<PromotionRedemptionResponse>[] = [
    {
      id: 'status',
      label: $localize`:@@featureAdminPromotions-colStatus:Status`,
      type: 'state',
      state: (item) => redemptionState(item.status),
    },
    {
      id: 'name',
      label: $localize`:@@featureAdminPromotions-colSubscription:Subscription`,
      value: (item) => this.redemptionSubscriptionLabel(item),
      required: true,
      priority: 1,
    },
    {
      id: 'redeemedAt',
      label: $localize`:@@featureAdminPromotions-colRedeemedAt:Redeemed`,
      value: (item) => item.redeemedAt,
      priority: 1,
    },
    {
      id: 'plan',
      label: $localize`:@@featureAdminPromotions-colPlan:Plan`,
      value: (item) => item.planName ?? '',
      priority: 2,
    },
    {
      id: 'context',
      label: $localize`:@@featureAdminPromotions-colContext:Context`,
      value: (item) => this.redemptionContextLabel(item.redemptionContext),
      priority: 3,
    },
  ];

  readonly editLabel = $localize`:@@featureAdminPromotions-edit:Edit`;
  readonly deactivateLabel = $localize`:@@featureAdminPromotions-deactivate:Deactivate`;
  readonly cancelLabel = DB_DL_CANCEL;
  readonly bulkDeactivateTitle = $localize`:@@featureAdminPromotions-bulkDeactivateTitle:Deactivate promotions?`;
  readonly selected = signal<readonly string[]>([]);
  readonly confirmBulkDeactivate = signal(false);
  readonly bulkResult = signal<DbBulkResult | null>(null);
  readonly selectedPromotions = computed(() => {
    const ids = new Set(this.selected());

    return this.promotions().filter((promotion) => ids.has(promotion.id));
  });
  readonly selectedActivePromotions = computed(() =>
    this.selectedPromotions().filter((promotion) => promotion.isActive),
  );
  readonly bulkDeactivateMessage = computed(
    () =>
      $localize`:@@featureAdminPromotions-bulkDeactivateMessage:${this.selectedActivePromotions().length}:count: active promotions will be deactivated. Their codes can no longer be redeemed.`,
  );
  readonly rowMenu = (promotion: AdminPromotionResponse): FpcMenuItem[] => [
    { id: 'edit', label: this.editLabel, icon: 'pencil' },
    { id: 'redemptions', label: this.redemptionsTitle, icon: 'list-ul' },
    ...(promotion.isActive
      ? [{ id: 'deactivate', label: this.deactivateLabel, icon: 'slash-circle', danger: true, dividerBefore: true }]
      : []),
    dbCopyIdItem(),
  ];

  createForm: CreateAdminPromotionDto = this.emptyForm();
  editForm: CreateAdminPromotionDto & { id: string } = { ...this.emptyForm(), id: '' };
  selectedPromotion: AdminPromotionResponse | null = null;

  readonly advantageTypes: PromotionAdvantageType[] = ['fixed_amount_net', 'free_days', 'free_billing_periods'];
  readonly eligibilityOptions: PromotionSubscriptionEligibility[] = ['new', 'existing', 'both'];

  constructor() {
    effect(() => {
      const promotionId = this.redemptionsPromotionId();
      const page = this.redemptionsPage();
      const pageSize = this.redemptionsPageSize();

      this.redemptionsOpenCount();

      if (promotionId) untracked(() => this.facade.loadRedemptions(promotionId, page, pageSize));
    });
  }

  ngOnInit(): void {
    this.servicePlansFacade.loadServicePlans();
    this.serviceTypesFacade.loadServiceTypes();

    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.emptyForm();
        this.paging.reload();
      },
    });
    watchBillingMutationModalClose({
      loading$: this.updating$,
      error$: this.error$,
      open: this.editModalOpen,
      destroyRef: this.destroyRef,
    });
  }

  openCreateModal(): void {
    this.createForm = this.emptyForm();
    showBillingModal(this.createModalOpen);
  }

  openEditModal(promotion: AdminPromotionResponse): void {
    this.editForm = {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      description: promotion.description,
      redeemableFrom: promotion.redeemableFrom.slice(0, 16),
      redeemableTo: promotion.redeemableTo.slice(0, 16),
      maxTotalRedemptions: promotion.maxTotalRedemptions,
      maxPerUserRedemptions: promotion.maxPerUserRedemptions,
      isActive: promotion.isActive,
      advantageType: promotion.advantageType,
      advantageConfig: { ...promotion.advantageConfig },
      applicablePlanIds: [...(promotion.applicablePlanIds ?? [])],
      subscriptionEligibility: promotion.subscriptionEligibility,
    };
    this.onAdvantageTypeChange(this.editForm);
    showBillingModal(this.editModalOpen);
  }

  openRedemptionsModal(promotion: AdminPromotionResponse): void {
    this.selectedPromotion = promotion;
    this.redemptionsPage.set(1);
    this.redemptionsPromotionId.set(promotion.id);
    this.redemptionsOpenCount.update((count) => count + 1);
    showBillingModal(this.redemptionsModalOpen);
  }

  submitCreate(): void {
    this.facade.createPromotion(this.buildDto(this.createForm));
  }

  submitEdit(): void {
    const { id, ...dto } = this.editForm;

    this.facade.updatePromotion(id, this.buildDto(dto));
  }

  deactivate(promotion: AdminPromotionResponse): void {
    this.facade.deactivatePromotion(promotion.id);
  }

  onRowAction(promotion: AdminPromotionResponse, action: string): void {
    if (action === 'edit') this.openEditModal(promotion);
    else if (action === 'redemptions') this.openRedemptionsModal(promotion);
    else if (action === 'deactivate') this.deactivate(promotion);
    else if (action === 'copy-id') fpcCopyText(promotion.id);
  }

  /** Bulk Deactivate: one `deactivate` call per active promotion (same endpoint as the row action). */
  async deactivateSelected(): Promise<void> {
    const promotions = this.selectedActivePromotions();

    if (promotions.length === 0) return;

    const result = await fpcRunBulk(promotions, (promotion) =>
      firstValueFrom(this.promotionsService.deactivate(promotion.id)),
    );

    this.bulkResult.set(dbBulkSummary(result, (promotion) => promotion.name));
    this.selected.set([]);
    this.paging.reload();
  }

  periodLabel(promotion: AdminPromotionResponse): string {
    return formatBillingDateRange(promotion.redeemableFrom, promotion.redeemableTo);
  }

  redeemedAt(item: PromotionRedemptionResponse): string {
    return item.redeemedAt;
  }

  onAdvantageTypeChange(form: CreateAdminPromotionDto): void {
    if (form.advantageType === 'fixed_amount_net') {
      form.advantageConfig = { amountNet: Number(form.advantageConfig['amountNet'] ?? 0) };
    } else if (form.advantageType === 'free_days') {
      form.advantageConfig = { days: Number(form.advantageConfig['days'] ?? 0) };
    } else {
      form.advantageConfig = { periods: Number(form.advantageConfig['periods'] ?? 0) };
    }
  }

  onApplicablePlansChange(planIds: readonly string[] | null, form: CreateAdminPromotionDto): void {
    form.applicablePlanIds = [...(planIds ?? [])];
  }

  formatDate(value?: string): string {
    if (!value) return '-';

    return formatBillingDateTime(value, value ?? '-');
  }

  redemptionContextLabel(context: PromotionRedemptionResponse['redemptionContext']): string {
    return getPromotionRedemptionContextLabel(context);
  }

  eligibilityLabel(eligibility: PromotionSubscriptionEligibility): string {
    switch (eligibility) {
      case 'new':
        return $localize`:@@featureAdminPromotions-eligibilityNew:New subscriptions`;
      case 'existing':
        return $localize`:@@featureAdminPromotions-eligibilityExisting:Existing subscriptions`;
      case 'both':
        return $localize`:@@featureAdminPromotions-eligibilityBoth:New and existing`;
      default:
        return eligibility;
    }
  }

  advantageTypeLabel(type: PromotionAdvantageType): string {
    switch (type) {
      case 'fixed_amount_net':
        return $localize`:@@featureAdminPromotions-advantageTypeFixedAmountNet:Fixed amount (net)`;
      case 'free_days':
        return $localize`:@@featureAdminPromotions-advantageTypeFreeDays:Free days`;
      case 'free_billing_periods':
        return $localize`:@@featureAdminPromotions-advantageTypeFreeBillingPeriods:Free billing periods`;
      default:
        return type;
    }
  }

  advantageSummaryLabel(promotion: AdminPromotionResponse): string {
    const config = promotion.advantageConfig;

    switch (promotion.advantageType) {
      case 'fixed_amount_net': {
        const amount = formatBillingMoney(Number(config['amountNet'] ?? 0));

        return $localize`:@@featureAdminPromotions-advantageAmountNet:${amount} net credit`;
      }
      case 'free_days':
        return getPromotionFreeDaysLabel(Number(config['days'] ?? 0));
      case 'free_billing_periods':
        return getPromotionFreePeriodsLabel(Number(config['periods'] ?? 0));
      default:
        return promotion.advantageType;
    }
  }

  redemptionSubscriptionLabel(item: PromotionRedemptionResponse): string {
    return resolveNamedLabel(item.subscriptionNumber);
  }

  private buildDto(form: CreateAdminPromotionDto): CreateAdminPromotionDto {
    const maxTotalRaw = form.maxTotalRedemptions as number | string | null | undefined;
    const maxTotal =
      maxTotalRaw === null || maxTotalRaw === undefined || maxTotalRaw === '' ? undefined : Number(maxTotalRaw);

    return {
      ...form,
      code: form.code.trim(),
      description: form.description?.trim() || undefined,
      redeemableFrom: new Date(form.redeemableFrom).toISOString(),
      redeemableTo: new Date(form.redeemableTo).toISOString(),
      maxPerUserRedemptions: Number(form.maxPerUserRedemptions),
      maxTotalRedemptions: maxTotal != null && Number.isFinite(maxTotal) && maxTotal >= 1 ? maxTotal : undefined,
      advantageConfig: this.normalizeAdvantageConfig(form.advantageType, form.advantageConfig),
      applicablePlanIds: form.applicablePlanIds?.length ? form.applicablePlanIds : undefined,
    };
  }

  /** `fpc-form-control` number inputs emit strings; coerce before API submit. */
  private normalizeAdvantageConfig(
    type: PromotionAdvantageType,
    config: Record<string, unknown>,
  ): Record<string, unknown> {
    if (type === 'fixed_amount_net') {
      return { amountNet: Number(config['amountNet'] ?? 0) };
    }

    if (type === 'free_days') {
      return { days: Number(config['days'] ?? 0) };
    }

    return { periods: Number(config['periods'] ?? 0) };
  }

  private emptyForm(): CreateAdminPromotionDto {
    const now = new Date();
    const nextMonth = new Date(now);

    nextMonth.setMonth(nextMonth.getMonth() + 1);

    return {
      code: '',
      name: '',
      description: '',
      redeemableFrom: now.toISOString().slice(0, 16),
      redeemableTo: nextMonth.toISOString().slice(0, 16),
      maxPerUserRedemptions: 1,
      isActive: true,
      advantageType: 'fixed_amount_net',
      advantageConfig: { amountNet: 0 },
      applicablePlanIds: [],
      subscriptionEligibility: 'both',
    };
  }
}

/** Applicable-plan options (DB-08): plan name as label, service type as hint; list order kept. */
export function promotionPlanOptions(
  plans: readonly { id: string; name: string; serviceTypeId: string | null }[],
  types: readonly { id: string; name: string }[],
): FpcMultiSelectOption[] {
  return plans.map((plan) => {
    const typeName = plan.serviceTypeId ? types.find((type) => type.id === plan.serviceTypeId)?.name : undefined;

    return typeName ? { value: plan.id, label: plan.name, hint: typeName } : { value: plan.id, label: plan.name };
  });
}
