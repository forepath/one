import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  Input,
  QueryList,
  ViewChildren,
  inject,
  OnChanges,
  OnInit,
  SimpleChanges,
  computed,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  AdminBillingService,
  ServicePlansFacade,
  rateForTaxCategory,
  type OfferLineType,
  type ServicePlanResponse,
  type TaxPreviewRates,
} from '@forepath/decabill/frontend/data-access-billing-console';

import { createEmptyOfferFormLine, type OfferFormLineItem } from './admin-offer-form.util';
import {
  aggregateOfferDraftPricingSummaries,
  computePlanTemplateOfferLineTotals,
  computeProjectTemplateOfferLineTotals,
  computeStandardOfferLineTotals,
  toOfferLinePricingSummary,
  type OfferLineTotals,
  type PricingTotalsSummary,
} from './admin-offer-totals.util';
import { PlanOrderConfiguratorComponent } from '../plan-order-configurator/plan-order-configurator.component';
import { PricingTotalsSummaryComponent } from '../pricing-totals-summary/pricing-totals-summary.component';
import type { PricingTotalsLeadingRow } from '../pricing-totals-summary/pricing-totals.util';

@Component({
  selector: 'framework-admin-offer-line-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, PlanOrderConfiguratorComponent, PricingTotalsSummaryComponent],
  templateUrl: './admin-offer-line-editor.component.html',
})
export class AdminOfferLineEditorComponent implements OnInit, OnChanges {
  private readonly servicePlansFacade = inject(ServicePlansFacade);
  private readonly adminBillingService = inject(AdminBillingService);
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) prefix!: string;
  @Input({ required: true }) lines!: OfferFormLineItem[];
  @Input() customerUserId = '';

  @ViewChildren(PlanOrderConfiguratorComponent) private configurators!: QueryList<PlanOrderConfiguratorComponent>;

  readonly lineTypes: OfferLineType[] = ['standard', 'project_template', 'plan_template'];

  readonly taxRates = signal<TaxPreviewRates>({ standard: 19, reduced: 7 });
  readonly taxCategoryOptions = computed(() => {
    const rates = this.taxRates();

    return [
      { value: 'standard' as const, label: `Standard (${rates.standard}%)` },
      { value: 'reduced' as const, label: `Reduced (${rates.reduced}%)` },
    ];
  });

  readonly servicePlans = toSignal(this.servicePlansFacade.getServicePlans$(), {
    initialValue: [] as ServicePlanResponse[],
  });

  readonly plansLoading = toSignal(this.servicePlansFacade.getServicePlansLoading$(), { initialValue: false });
  private readonly planPricingRevision = signal(0);

  ngOnInit(): void {
    if (this.servicePlans().length === 0) {
      this.servicePlansFacade.loadServicePlans();
    }

    this.refreshTaxRates(this.customerUserId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['customerUserId'] && !changes['customerUserId'].firstChange) {
      this.refreshTaxRates(this.customerUserId);
    }
  }

  addLine(): void {
    this.lines.push(createEmptyOfferFormLine());
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
  }

  onLineTypeChange(line: OfferFormLineItem, lineType: OfferLineType): void {
    const next = createEmptyOfferFormLine(lineType);

    next.description = line.description;
    next.scheduledAt = line.scheduledAt;
    Object.assign(line, next);
  }

  onPlanIdChange(line: OfferFormLineItem, planId: string): void {
    line.planId = planId;
    line.requestedConfig = {};
    line.addonIds = [];
    line.addonConfigs = {};
  }

  onTaxCategoryChange(line: OfferFormLineItem, value: 'standard' | 'reduced'): void {
    line.taxCategory = value;
  }

  onPlanPricingUpdated(): void {
    this.planPricingRevision.update((value) => value + 1);
  }

  lineTypeLabel(lineType: OfferLineType): string {
    switch (lineType) {
      case 'project_template':
        return $localize`:@@featureAdminOffers-lineTypeProject:Project template`;
      case 'plan_template':
        return $localize`:@@featureAdminOffers-lineTypePlan:Plan template`;
      default:
        return $localize`:@@featureAdminOffers-lineTypeStandard:Generic`;
    }
  }

  planLabel(plan: ServicePlanResponse): string {
    return plan.name?.trim() || plan.id;
  }

  lineSummary(line: OfferFormLineItem, lineIndex: number): PricingTotalsSummary | null {
    this.planPricingRevision();

    return toOfferLinePricingSummary(this.computeLineTotals(line, lineIndex));
  }

  lineLeadingRows(line: OfferFormLineItem, lineIndex: number): PricingTotalsLeadingRow[] {
    this.planPricingRevision();

    if (line.lineType !== 'plan_template' || !line.planId.trim()) {
      return [];
    }

    return this.configurators?.find((entry) => entry.lineIndex === lineIndex)?.pricingLeadingRows() ?? [];
  }

  linePricingLoading(line: OfferFormLineItem, lineIndex: number): boolean {
    this.planPricingRevision();

    if (line.lineType !== 'plan_template' || !line.planId.trim()) {
      return false;
    }

    return this.configurators?.find((entry) => entry.lineIndex === lineIndex)?.pricingLoading ?? false;
  }

  draftSummary(): PricingTotalsSummary | null {
    this.planPricingRevision();

    const lineTotals = this.lines.map((line, index) => this.computeLineTotals(line, index));

    return aggregateOfferDraftPricingSummaries(lineTotals);
  }

  private computeLineTotals(line: OfferFormLineItem, lineIndex: number): OfferLineTotals | null {
    const taxRates = this.taxRates();

    switch (line.lineType) {
      case 'project_template':
        return computeProjectTemplateOfferLineTotals(line, taxRates);
      case 'plan_template': {
        if (!line.planId.trim()) {
          const taxRate = rateForTaxCategory(taxRates, 'standard');

          return { net: 0, tax: 0, gross: 0, taxRate };
        }

        const configurator = this.configurators?.find((entry) => entry.lineIndex === lineIndex);

        return computePlanTemplateOfferLineTotals(configurator?.pricingPreview() ?? null);
      }
      default:
        return computeStandardOfferLineTotals(line, taxRates);
    }
  }

  private refreshTaxRates(userId?: string): void {
    this.adminBillingService
      .previewTax(userId?.trim() ? { userId: userId.trim() } : {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => this.taxRates.set(preview.rates),
        error: () => undefined,
      });
  }
}
