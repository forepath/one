import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type { SubmitContactRequestPayload } from '../../types/contact-request.types';

import { resetContactRequest, submitContactRequest } from './contact-request.actions';
import {
  selectContactRequestError,
  selectContactRequestReferenceId,
  selectContactRequestSubmitted,
  selectContactRequestSubmitting,
} from './contact-request.selectors';

@Injectable()
export class ContactRequestFacade {
  private readonly store = inject(Store);

  getSubmitting$(): Observable<boolean> {
    return this.store.select(selectContactRequestSubmitting);
  }

  getSubmitted$(): Observable<boolean> {
    return this.store.select(selectContactRequestSubmitted);
  }

  getReferenceId$(): Observable<string | null> {
    return this.store.select(selectContactRequestReferenceId);
  }

  getError$(): Observable<string | null> {
    return this.store.select(selectContactRequestError);
  }

  submit(payload: SubmitContactRequestPayload): void {
    this.store.dispatch(submitContactRequest({ payload }));
  }

  reset(): void {
    this.store.dispatch(resetContactRequest());
  }
}
