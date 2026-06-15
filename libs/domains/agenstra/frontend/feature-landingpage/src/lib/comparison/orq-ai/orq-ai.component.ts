import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { ORQ_AI_COMPARISON_PAGE } from './orq-ai.page';

@Component({
  selector: 'framework-portal-comparison-orq-ai',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonOrqAiComponent {
  readonly page = ORQ_AI_COMPARISON_PAGE;
}
