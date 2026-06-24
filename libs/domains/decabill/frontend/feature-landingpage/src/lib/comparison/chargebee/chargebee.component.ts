import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { CHARGEBEE_COMPARISON_PAGE } from './chargebee.page';

@Component({
  selector: 'framework-portal-comparison-chargebee',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonChargebeeComponent {
  readonly page = CHARGEBEE_COMPARISON_PAGE;
}
