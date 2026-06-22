import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { WHMCS_COMPARISON_PAGE } from './whmcs.page';

@Component({
  selector: 'framework-portal-comparison-whmcs',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonWhmcsComponent {
  readonly page = WHMCS_COMPARISON_PAGE;
}
