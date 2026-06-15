import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { PORTKEY_COMPARISON_PAGE } from './portkey.page';

@Component({
  selector: 'framework-portal-comparison-portkey',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonPortkeyComponent {
  readonly page = PORTKEY_COMPARISON_PAGE;
}
