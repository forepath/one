import { ChangeDetectionStrategy, Component } from '@angular/core';

import { PortalComparisonLayoutComponent } from '../shared/layout/comparison-layout.component';

import { CURSOR_COMPARISON_PAGE } from './cursor.page';

@Component({
  selector: 'framework-portal-comparison-cursor',
  standalone: true,
  imports: [PortalComparisonLayoutComponent],
  template: '<framework-portal-comparison-layout [page]="page" />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalComparisonCursorComponent {
  readonly page = CURSOR_COMPARISON_PAGE;
}
