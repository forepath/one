import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, of, switchMap } from 'rxjs';

import { ContactRequestService } from '../../services/contact-request.service';

import {
  submitContactRequest,
  submitContactRequestFailure,
  submitContactRequestSuccess,
} from './contact-request.actions';

export function normalizeContactRequestError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;

    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;

      if (Array.isArray(message)) {
        return message.map(String).join(', ');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  return 'An unexpected error occurred';
}

export const submitContactRequest$ = createEffect(
  (actions$ = inject(Actions), contactRequestService = inject(ContactRequestService)) => {
    return actions$.pipe(
      ofType(submitContactRequest),
      switchMap(({ payload }) =>
        contactRequestService.submit(payload).pipe(
          map((response) => submitContactRequestSuccess({ referenceId: response.referenceId })),
          catchError((error) => of(submitContactRequestFailure({ error: normalizeContactRequestError(error) }))),
        ),
      ),
    );
  },
  { functional: true },
);
