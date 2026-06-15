import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { TABNINE_ENTERPRISE_COMPARISON_PAGE } from './tabnine-enterprise.page';

@Component({
  selector: 'framework-portal-comparison-tabnine-enterprise',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonTabnineEnterpriseComponent {
  readonly page = TABNINE_ENTERPRISE_COMPARISON_PAGE;
}
