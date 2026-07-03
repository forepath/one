import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';

import { resetContactRequest, submitContactRequest } from './contact-request.actions';
import { ContactRequestFacade } from './contact-request.facade';

describe('ContactRequestFacade', () => {
  let facade: ContactRequestFacade;
  let store: jest.Mocked<Store>;

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [ContactRequestFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ContactRequestFacade);
  });

  it.each([
    ['getSubmitting$', () => facade.getSubmitting$(), true],
    ['getSubmitted$', () => facade.getSubmitted$(), false],
    ['getReferenceId$', () => facade.getReferenceId$(), 'ref-1'],
    ['getError$', () => facade.getError$(), 'Captcha failed'],
  ])('%s should select from store', async (_label, observableFactory, expected) => {
    store.select.mockReturnValue(of(expected));
    await expect(firstValueFrom(observableFactory())).resolves.toEqual(expected);
  });

  it('submit should dispatch submitContactRequest', () => {
    const payload = {
      name: 'Jane',
      email: 'jane@example.com',
      message: 'Hello',
      turnstileToken: 'token',
    };

    facade.submit(payload);
    expect(store.dispatch).toHaveBeenCalledWith(submitContactRequest({ payload }));
  });

  it('reset should dispatch resetContactRequest', () => {
    facade.reset();
    expect(store.dispatch).toHaveBeenCalledWith(resetContactRequest());
  });
});
