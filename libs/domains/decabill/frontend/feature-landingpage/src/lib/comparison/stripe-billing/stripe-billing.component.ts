import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { STRIPE_BILLING_COMPARISON_PAGE } from './stripe-billing.page';

@Component({
  selector: 'framework-portal-comparison-stripe-billing',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonStripeBillingComponent {
  readonly page = STRIPE_BILLING_COMPARISON_PAGE;
}
