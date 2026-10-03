import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ENVIRONMENT, type EnvironmentWithCommunication } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import { PUBLIC_CONTENT_REPORTS_PATH } from '../constants/content-report.constants';
import type { ContentReportResponse, SubmitContentReportPayload } from '../types/content-report.types';

@Injectable({
  providedIn: 'root',
})
export class ContentReportService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<EnvironmentWithCommunication>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.communication.urls.restApi;
  }

  submit(payload: SubmitContentReportPayload): Observable<ContentReportResponse> {
    const formData = new FormData();

    formData.append('reportType', payload.reportType);
    formData.append('turnstileToken', payload.turnstileToken);
    formData.append('contentUrls', payload.contentUrls);

    appendOptional(formData, 'name', payload.name);
    appendOptional(formData, 'email', payload.email);
    appendOptional(formData, 'explanation', payload.explanation);
    appendOptional(formData, 'additionalIdentifiers', payload.additionalIdentifiers);
    appendOptional(formData, 'illegalContentCategory', payload.illegalContentCategory);
    appendOptionalBoolean(formData, 'csamAnonymous', payload.csamAnonymous);
    appendOptionalBoolean(formData, 'goodFaithConfirmed', payload.goodFaithConfirmed);
    appendOptional(formData, 'authorityName', payload.authorityName);
    appendOptional(formData, 'memberState', payload.memberState);
    appendOptional(formData, 'officialName', payload.officialName);
    appendOptional(formData, 'officialRole', payload.officialRole);
    appendOptional(formData, 'orderReference', payload.orderReference);
    appendOptional(formData, 'orderIssuedAt', payload.orderIssuedAt);
    appendOptional(formData, 'statementOfReasons', payload.statementOfReasons);
    appendOptional(formData, 'redressInformation', payload.redressInformation);
    appendOptional(formData, 'preferredLanguage', payload.preferredLanguage);
    appendOptionalBoolean(formData, 'emergencyCase', payload.emergencyCase);
    appendOptionalBoolean(formData, 'authorityAttestation', payload.authorityAttestation);

    if (payload.removalOrderPdf) {
      formData.append('removalOrderPdf', payload.removalOrderPdf, payload.removalOrderPdf.name);
    }

    return this.http.post<ContentReportResponse>(`${this.apiUrl}/${PUBLIC_CONTENT_REPORTS_PATH}`, formData);
  }
}

function appendOptional(formData: FormData, key: string, value: string | undefined): void {
  if (value != null && value !== '') {
    formData.append(key, value);
  }
}

function appendOptionalBoolean(formData: FormData, key: string, value: boolean | undefined): void {
  if (value != null) {
    formData.append(key, String(value));
  }
}
