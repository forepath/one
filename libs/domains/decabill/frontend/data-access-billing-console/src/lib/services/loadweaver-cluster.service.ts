import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/decabill/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';
import { Observable } from 'rxjs';

import type { LoadweaverClusterInfo } from '../types/billing.types';

/** Service-detail tab id contributed by the `loadweaver` integrated stack. */
export const LOADWEAVER_CLUSTER_TAB_ID = 'loadweaver-cluster';

/** Error code of a cancellation that lacks the Loadweaver data-deletion confirmation. */
export const LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED = 'LOADWEAVER_TEARDOWN_CONFIRMATION_REQUIRED';

/** True when one of the items runs Decabill's `loadweaver` service kind. */
export function hasLoadweaverItem(items: ReadonlyArray<{ service?: string }> | null | undefined): boolean {
  return (items ?? []).some((item) => item.service === 'loadweaver');
}

/** Read-only view of a Decabill-provisioned Loadweaver cluster (one request per tab load / refresh). */
@Injectable({
  providedIn: 'root',
})
export class LoadweaverClusterService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  getCluster(subscriptionId: string, itemId: string, adminMode = false): Observable<LoadweaverClusterInfo> {
    const base = this.environment.billing.urls.restApi;
    const scope = adminMode ? 'admin/billing/subscriptions' : 'subscriptions';

    return this.http.get<LoadweaverClusterInfo>(
      `${base}/${scope}/${subscriptionId}/items/${itemId}/loadweaver/cluster`,
    );
  }
}
