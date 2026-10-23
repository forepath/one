import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import type { CrossProjectRequest } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcBadgeComponent,
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * Cross-project requests towards a project (3.17): policies of other projects reaching its groups, from pending plans
 * and applied policies. Operators and admins of the project accept exactly the version shown (spec hash).
 */
@Component({
  selector: 'loadweaver-access-requests',
  imports: [
    CommonModule,
    RouterModule,
    FpcBadgeComponent,
    FpcButtonComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
  ],
  templateUrl: './access-requests.component.html',
  standalone: true,
  // A flex column that fills its parent, so the empty state stretches like a page-level one.
  host: { class: 'd-flex flex-column flex-grow-1' },
})
export class LoadweaverAccessRequestsComponent {
  readonly requests = input<CrossProjectRequest[]>([]);
  /** The caller may accept (operator or admin of the accepting project). */
  readonly mayAccept = input(false);
  readonly changing = input(false);
  readonly accept = output<CrossProjectRequest>();

  key(request: CrossProjectRequest): string {
    return `${request.project}/${request.policy}/${request.specHash}/${request.planId ?? ''}`;
  }
}
