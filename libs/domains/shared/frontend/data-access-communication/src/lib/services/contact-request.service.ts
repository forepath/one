import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Environment } from '@forepath/shared/frontend/util-configuration';
import { ENVIRONMENT } from '@forepath/shared/frontend/util-configuration';
import { Observable } from 'rxjs';

import { PUBLIC_CONTACT_REQUESTS_PATH } from '../constants/contact-request.constants';
import type { ContactRequestResponse, SubmitContactRequestPayload } from '../types/contact-request.types';

@Injectable({
  providedIn: 'root',
})
export class ContactRequestService {
  private readonly http = inject(HttpClient);
  private readonly environment = inject<Environment>(ENVIRONMENT);

  private get apiUrl(): string {
    return this.environment.communication.restApiUrl;
  }

  submit(payload: SubmitContactRequestPayload): Observable<ContactRequestResponse> {
    return this.http.post<ContactRequestResponse>(`${this.apiUrl}/${PUBLIC_CONTACT_REQUESTS_PATH}`, payload);
  }
}
