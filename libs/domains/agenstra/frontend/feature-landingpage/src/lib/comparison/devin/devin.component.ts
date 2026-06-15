import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { DEVIN_COMPARISON_PAGE } from './devin.page';

@Component({
  selector: 'framework-portal-comparison-devin',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonDevinComponent {
  readonly page = DEVIN_COMPARISON_PAGE;
}
