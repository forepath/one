import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { PADDLE_COMPARISON_PAGE } from './paddle.page';

@Component({
  selector: 'framework-portal-comparison-paddle',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonPaddleComponent {
  readonly page = PADDLE_COMPARISON_PAGE;
}
