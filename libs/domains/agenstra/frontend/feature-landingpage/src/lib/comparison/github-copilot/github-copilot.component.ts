import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { GITHUB_COPILOT_COMPARISON_PAGE } from './github-copilot.page';

@Component({
  selector: 'framework-portal-comparison-github-copilot',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonGithubCopilotComponent {
  readonly page = GITHUB_COPILOT_COMPARISON_PAGE;
}
