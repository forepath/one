import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { ContactRequestService } from '../../services/contact-request.service';

import {
  submitContactRequest,
  submitContactRequestFailure,
  submitContactRequestSuccess,
} from './contact-request.actions';
import { normalizeContactRequestError, submitContactRequest$ } from './contact-request.effects';

describe('normalizeContactRequestError', () => {
  it('should extract string message from HttpErrorResponse body', () => {
    const error = new HttpErrorResponse({
      error: { message: 'Invalid captcha' },
      status: 400,
      statusText: 'Bad Request',
    });

    expect(normalizeContactRequestError(error)).toBe('Invalid captcha');
  });

  it('should join array messages from HttpErrorResponse body', () => {
    const error = new HttpErrorResponse({
      error: { message: ['name must be shorter', 'email must be valid'] },
      status: 400,
      statusText: 'Bad Request',
    });

    expect(normalizeContactRequestError(error)).toBe('name must be shorter, email must be valid');
  });

  it('should fall back to Error message', () => {
    expect(normalizeContactRequestError(new Error('Network down'))).toBe('Network down');
  });
});

describe('submitContactRequest$', () => {
  let actions$: Actions;
  let contactRequestService: jest.Mocked<ContactRequestService>;
  const payload = {
    name: 'Jane',
    email: 'jane@example.com',
    message: 'Hello',
    turnstileToken: 'token',
  };

  beforeEach(() => {
    contactRequestService = {
      submit: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [
        provideMockActions(() => actions$),
        { provide: ContactRequestService, useValue: contactRequestService },
      ],
    });

    actions$ = TestBed.inject(Actions);
  });

  it('should dispatch submitContactRequestSuccess on success', (done) => {
    actions$ = of(submitContactRequest({ payload }));
    contactRequestService.submit.mockReturnValue(of({ accepted: true, referenceId: 'ref-99' }));

    submitContactRequest$(actions$, contactRequestService).subscribe((result) => {
      expect(result).toEqual(submitContactRequestSuccess({ referenceId: 'ref-99' }));
      done();
    });
  });

  it('should dispatch submitContactRequestFailure on error', (done) => {
    actions$ = of(submitContactRequest({ payload }));
    contactRequestService.submit.mockReturnValue(
      throwError(() => new HttpErrorResponse({ error: { message: 'Rate limit' }, status: 429 })),
    );

    submitContactRequest$(actions$, contactRequestService).subscribe((result) => {
      expect(result).toEqual(submitContactRequestFailure({ error: 'Rate limit' }));
      done();
    });
  });
});
