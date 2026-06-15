import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { CODEIUM_WINDSURF_COMPARISON_PAGE } from './codeium-windsurf.page';

@Component({
  selector: 'framework-portal-comparison-codeium-windsurf',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonCodeiumWindsurfComponent {
  readonly page = CODEIUM_WINDSURF_COMPARISON_PAGE;
}
