import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import { PUBLIC_SERVICE_PLAN_OFFERINGS_PATH } from '../constants/service-plans.constants';
import type {
  PublicServicePlanOffering,
  PublicServicePlanOfferingsListParams,
} from '../types/portal-service-plans.types';

@Injectable({
  providedIn: 'root',
})
export class PublicServicePlanOfferingsService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.billing.restApiUrl;
  }

  listOfferings(params?: PublicServicePlanOfferingsListParams): Observable<PublicServicePlanOffering[]> {
    let httpParams = new HttpParams();

    if (params?.limit !== undefined) {
      httpParams = httpParams.set('limit', params.limit.toString());
    }

    if (params?.offset !== undefined) {
      httpParams = httpParams.set('offset', params.offset.toString());
    }

    if (params?.serviceTypeId !== undefined && params.serviceTypeId !== '') {
      httpParams = httpParams.set('serviceTypeId', params.serviceTypeId);
    }

    return this.http.get<PublicServicePlanOffering[]>(`${this.apiUrl}/${PUBLIC_SERVICE_PLAN_OFFERINGS_PATH}`, {
      params: httpParams,
    });
  }

  getCheapestOffering(serviceTypeId?: string): Observable<PublicServicePlanOffering> {
    let httpParams = new HttpParams();

    if (serviceTypeId !== undefined && serviceTypeId !== '') {
      httpParams = httpParams.set('serviceTypeId', serviceTypeId);
    }

    return this.http.get<PublicServicePlanOffering>(`${this.apiUrl}/${PUBLIC_SERVICE_PLAN_OFFERINGS_PATH}/cheapest`, {
      params: httpParams,
    });
  }
}
