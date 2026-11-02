import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ConsoleEndpointService } from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcButtonComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
} from '@forepath/shared/frontend/ui-components';

import { fleetUnavailableReason } from './fleet-format';

/**
 * Fleet mode: one of the few cluster pages that stay native by decision (`FLEET_UNAVAILABLE_PATHS`: the service
 * account's VPN devices and linked Git accounts, trusted fleets) — the notice says why for that page and links to the
 * cluster's own console when its address is known; for trusted fleets also to the fleet's cluster page, where trust
 * with this fleet is established (2026-10-29).
 */
@Component({
  selector: 'loadweaver-fleet-unavailable-page',
  imports: [RouterModule, FpcButtonComponent, FpcEmptyStateComponent, FpcPageHeaderComponent],
  standalone: true,
  template: `
    <div class="fpc-page">
      <fpc-page-header [title]="title" />
      <div class="flex-grow-1 overflow-auto d-flex flex-column min-h-0">
        <fpc-empty-state icon="slash-circle" [title]="heading" [message]="message" data-testid="fleet-unavailable">
          <div fpcEmptyStateActions class="d-flex flex-wrap justify-content-center gap-2">
            @if (trustPage) {
              <!-- Trust with this fleet is handled in the fleet (2026-10-29), not in the cluster's console. -->
              <fpc-button variant="primary" size="sm" [routerLink]="clusterPage" data-testid="fleet-unavailable-trust">
                <i class="bi bi-shield-check me-1" aria-hidden="true"></i
                ><span i18n="@@lwConsoleFleetUnavailable-trust">Trust on the cluster page</span>
              </fpc-button>
            }
            @if (nativeUrl; as url) {
              <fpc-button
                variant="dark"
                size="sm"
                [href]="url"
                target="_blank"
                rel="noopener"
                data-testid="fleet-unavailable-native"
              >
                <i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i
                ><span i18n="@@lwConsoleFleetUnavailable-openNative">Open in the cluster's console</span>
              </fpc-button>
            }
            <fpc-button variant="dark" size="sm" routerLink="/">
              <span i18n="@@lwConsoleFleetUnavailable-overview">Cluster overview</span>
            </fpc-button>
            <fpc-button variant="primary" size="sm" routerLink="/fleet">
              <span i18n="@@lwConsoleFleetUnavailable-fleet">Fleet overview</span>
            </fpc-button>
          </div>
        </fpc-empty-state>
      </div>
    </div>
  `,
})
export class LoadweaverFleetUnavailablePageComponent {
  private readonly page = inject(ActivatedRoute).snapshot.queryParamMap.get('page');
  private readonly endpoints = inject(ConsoleEndpointService);

  readonly title = $localize`:@@lwConsoleFleetUnavailable-title:Not available through the fleet`;
  readonly heading = this.page
    ? `${$localize`:@@lwConsoleFleetUnavailable-headingPage:Not available through the fleet:`} ${this.page}`
    : this.title;
  readonly message =
    (this.page && fleetUnavailableReason(this.page)) ??
    $localize`:@@lwConsoleFleetUnavailable-other:This page is only available in the cluster's own console.`;
  /** `/settings/trusted-fleets`: the fleet's own trust with the active cluster lives on the fleet's cluster page. */
  readonly trustPage = /^\/(?:(?:de|en)\/)?settings\/trusted-fleets(?:[/?#]|$)/.test(this.page ?? '');
  readonly clusterPage = this.endpoints.activeClusterId()
    ? ['/fleet/clusters', this.endpoints.activeClusterId()]
    : ['/fleet/clusters'];
  /** Only the decided native pages get a link (the `page` parameter is never used as a URL otherwise). */
  readonly nativeUrl =
    this.page && fleetUnavailableReason(this.page) ? this.endpoints.nativeConsoleUrl(this.page.split(/[?#]/)[0]) : null;
}
