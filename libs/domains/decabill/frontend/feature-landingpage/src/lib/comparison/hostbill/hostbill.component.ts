import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { HOSTBILL_COMPARISON_PAGE } from './hostbill.page';

@Component({
  selector: 'framework-portal-comparison-hostbill',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonHostbillComponent {
  readonly page = HOSTBILL_COMPARISON_PAGE;
}
