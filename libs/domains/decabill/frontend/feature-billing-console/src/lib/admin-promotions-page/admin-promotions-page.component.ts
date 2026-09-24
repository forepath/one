import { CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminPromotionsFacade,
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
  FpcButtonGroupComponent,
  FpcEmptyStateComponent,
  FpcFormControlComponent,
  FpcFormFieldComponent,
  FpcFormSwitchComponent,
  FpcListComponent,
  FpcModalComponent,
  FpcModalFooterDirective,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcSearchFieldComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';
import { combineLatest, debounceTime, distinctUntilChanged, map, skip } from 'rxjs';

import {
  getActiveStatusLabel,
  getActiveStatusTextClass,
  getPromotionRedemptionContextLabel,
  getPromotionRedemptionStatusIconClass,
  getPromotionRedemptionStatusLabel,
  getPromotionRedemptionStatusTextClass,
  getUnavailableLabel,
  resolveNamedLabel,
} from '../billing-status-labels';
import { showBillingModal, watchBillingMutationModalClose } from '../billing-modal';

@Component({
  selector: 'framework-admin-promotions-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcButtonGroupComponent,
    FpcFormControlComponent,
    FpcFormFieldComponent,
    FpcFormSwitchComponent,
    FpcModalComponent,
    FpcModalFooterDirective,
    FpcListItemComponent,
    FpcListComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSearchFieldComponent,
    FpcSpinnerComponent,
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
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly serviceTypesFacade = inject(ServiceTypesFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly datePipe = inject(DatePipe);

  readonly searchQuery = signal('');
  readonly searchQuery$ = toObservable(this.searchQuery);
  readonly allPromotions$ = this.facade.getPromotions$();
  readonly promotions$ = this.facade.getPromotions$();
  readonly loading$ = this.facade.getLoading$();
  readonly creating$ = this.facade.getCreating$();
  readonly updating$ = this.facade.getUpdating$();
  readonly deactivating$ = this.facade.getDeactivating$();
  readonly loadingAny$ = combineLatest([this.creating$, this.updating$, this.deactivating$]).pipe(
    map(([creating, updating, deactivating]) => creating || updating || deactivating),
  );
  readonly error$ = this.facade.getError$();
  readonly redemptions$ = this.facade.getRedemptions$();
  readonly redemptionsLoading$ = this.facade.getRedemptionsLoading$();
  readonly servicePlans$ = combineLatest([
    this.servicePlansFacade.getServicePlans$(),
    this.serviceTypesFacade.getServiceTypes$(),
  ]).pipe(map(([plans, types]) => ({ plans, types })));

  createForm: CreateAdminPromotionDto = this.emptyForm();
  editForm: CreateAdminPromotionDto & { id: string } = { ...this.emptyForm(), id: '' };
  selectedPromotion: AdminPromotionResponse | null = null;

  readonly advantageTypes: PromotionAdvantageType[] = ['fixed_amount_net', 'free_days', 'free_billing_periods'];
  readonly eligibilityOptions: PromotionSubscriptionEligibility[] = ['new', 'existing', 'both'];

  ngOnInit(): void {
    this.facade.loadPromotions();
    this.servicePlansFacade.loadServicePlans();
    this.serviceTypesFacade.loadServiceTypes();

    this.searchQuery$
      .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((search) => {
        this.facade.loadPromotions({ search: search.trim() || undefined });
      });

    watchBillingMutationModalClose({
      loading$: this.creating$,
      error$: this.error$,
      open: this.createModalOpen,
      destroyRef: this.destroyRef,
      onSuccess: () => {
        this.createForm = this.emptyForm();
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
    this.facade.loadRedemptions(promotion.id);
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

  onAdvantageTypeChange(form: CreateAdminPromotionDto): void {
    if (form.advantageType === 'fixed_amount_net') {
      form.advantageConfig = { amountNet: Number(form.advantageConfig['amountNet'] ?? 0) };
    } else if (form.advantageType === 'free_days') {
      form.advantageConfig = { days: Number(form.advantageConfig['days'] ?? 0) };
    } else {
      form.advantageConfig = { periods: Number(form.advantageConfig['periods'] ?? 0) };
    }
  }

  onApplicablePlansChange(event: Event, form: CreateAdminPromotionDto): void {
    const select = event.target as HTMLSelectElement;

    form.applicablePlanIds = Array.from(select.selectedOptions).map((option) => option.value);
  }

  formatDate(value?: string): string {
    if (!value) return '-';

    return this.datePipe.transform(value, 'medium') ?? value;
  }

  redemptionContextLabel(context: PromotionRedemptionResponse['redemptionContext']): string {
    return getPromotionRedemptionContextLabel(context);
  }

  redemptionStatusLabel(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusLabel(status);
  }

  redemptionStatusTextClass(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusTextClass(status);
  }

  redemptionStatusIconClass(status: PromotionRedemptionResponse['status']): string {
    return getPromotionRedemptionStatusIconClass(status);
  }

  activeStatusLabel(isActive: boolean): string {
    return getActiveStatusLabel(isActive);
  }

  activeStatusTextClass(isActive: boolean): string {
    return getActiveStatusTextClass(isActive);
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
      case 'fixed_amount_net':
        return $localize`:@@featureAdminPromotions-advantageAmountNet:${Number(config['amountNet'] ?? 0)} net credit`;
      case 'free_days':
        return $localize`:@@featureAdminPromotions-advantageFreeDays:${Number(config['days'] ?? 0)} free days`;
      case 'free_billing_periods':
        return $localize`:@@featureAdminPromotions-advantageFreePeriods:${Number(config['periods'] ?? 0)} free billing periods`;
      default:
        return promotion.advantageType;
    }
  }

  planLabel(
    planId: string,
    plans: { id: string; name: string; serviceTypeId: string | null }[],
    types: { id: string; name: string }[],
  ): string {
    const plan = plans.find((item) => item.id === planId);

    if (!plan) return getUnavailableLabel();

    const typeName = plan.serviceTypeId ? (types.find((item) => item.id === plan.serviceTypeId)?.name ?? '') : '';

    return typeName ? `${plan.name} (${typeName})` : plan.name;
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
