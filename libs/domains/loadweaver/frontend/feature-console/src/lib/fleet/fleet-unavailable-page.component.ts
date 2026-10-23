import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
} from '@forepath/shared/frontend/ui-components';

/**
 * Fleet mode: a cluster page the fleet's relay never carries (Git connections, devices, posture, imports, status
 * pages, linked Git accounts, webhooks, …) — it is only available in the cluster's own console.
 */
@Component({
  selector: 'loadweaver-fleet-unavailable-page',
  imports: [RouterModule, FpcButtonComponent, FpcEmptyStateComponent, FpcPageHeaderComponent],
  standalone: true,
  template: `
    <div class="border-top d-flex flex-column flex-grow-1 min-h-0">
      <fpc-page-header [title]="title" icon="slash-circle" />
      <div class="flex-grow-1 overflow-auto d-flex flex-column min-h-0">
        <fpc-empty-state icon="slash-circle" [title]="heading" [message]="message" data-testid="fleet-unavailable" />
        <div class="d-flex justify-content-center gap-2 pb-4">
          <fpc-button variant="secondary" size="sm" routerLink="/overview">
            <span i18n="@@lwConsoleFleetUnavailable-overview">Cluster overview</span>
          </fpc-button>
          <fpc-button variant="primary" size="sm" routerLink="/fleet">
            <span i18n="@@lwConsoleFleetUnavailable-fleet">Fleet overview</span>
          </fpc-button>
        </div>
      </div>
    </div>
  `,
})
export class LoadweaverFleetUnavailablePageComponent {
  private readonly page = inject(ActivatedRoute).snapshot.queryParamMap.get('page');

  readonly title = $localize`:@@lwConsoleFleetUnavailable-title:Not available through the fleet`;
  readonly heading = this.page
    ? `${$localize`:@@lwConsoleFleetUnavailable-headingPage:Not available through the fleet:`} ${this.page}`
    : this.title;
  readonly message = $localize`:@@lwConsoleFleetUnavailable-message:This part of the cluster is never relayed by the fleet (secrets, personal settings of the service user, joining, Git connections, approvals). Open it in the cluster's own console.`;
}
