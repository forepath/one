import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FpcSpinnerComponent } from '@forepath/shared/frontend/ui-components';

import {
  formatPricingCurrencyAmount,
  type PricingTotalsLeadingRow,
  type PricingTotalsSummary,
} from './pricing-totals.util';

export type PricingTotalsSummaryVariant = 'tertiary' | 'primary';

@Component({
  selector: 'framework-pricing-totals-summary',
  standalone: true,
  imports: [CommonModule, FpcSpinnerComponent],
  templateUrl: './pricing-totals-summary.component.html',
})
export class PricingTotalsSummaryComponent {
  @Input() summary: PricingTotalsSummary | null = null;
  @Input() loading = false;
  @Input() leadingRows: PricingTotalsLeadingRow[] = [];
  @Input() variant: PricingTotalsSummaryVariant = 'tertiary';

  get isPrimary(): boolean {
    return this.variant === 'primary';
  }

  formatAmount(amount: number): string {
    return formatPricingCurrencyAmount(amount);
  }
}
