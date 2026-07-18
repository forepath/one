import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  clearCreatedPersonalAccessTokenPlaintext,
  clearPersonalAccessTokensError,
  createPersonalAccessToken,
  loadPersonalAccessTokenScopes,
  loadPersonalAccessTokens,
  revokePersonalAccessToken,
  updatePersonalAccessToken,
} from './personal-access-tokens.actions';
import { PersonalAccessTokensFacade } from './personal-access-tokens.facade';

describe('PersonalAccessTokensFacade', () => {
  let facade: PersonalAccessTokensFacade;
  let store: { select: jest.Mock; dispatch: jest.Mock };

  beforeEach(() => {
    store = {
      select: jest.fn().mockReturnValue(of(true)),
      dispatch: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [PersonalAccessTokensFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(PersonalAccessTokensFacade);
  });

  it('exposes store selectors', (done) => {
    facade.loading$.subscribe((value) => {
      expect(value).toBe(true);
      expect(store.select).toHaveBeenCalled();
      done();
    });
  });

  it('dispatches load/create/update/revoke/clear actions', () => {
    facade.load();
    facade.loadScopes();
    facade.create({ name: 'CI', scopes: ['usage:write'] });
    facade.update('t1', { name: 'CI2', scopes: ['usage:write'] });
    facade.revoke('t1');
    facade.clearCreatedPlaintext();
    facade.clearError();

    expect(store.dispatch).toHaveBeenCalledWith(loadPersonalAccessTokens());
    expect(store.dispatch).toHaveBeenCalledWith(loadPersonalAccessTokenScopes());
    expect(store.dispatch).toHaveBeenCalledWith(
      createPersonalAccessToken({ dto: { name: 'CI', scopes: ['usage:write'] } }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      updatePersonalAccessToken({ id: 't1', dto: { name: 'CI2', scopes: ['usage:write'] } }),
    );
    expect(store.dispatch).toHaveBeenCalledWith(revokePersonalAccessToken({ id: 't1' }));
    expect(store.dispatch).toHaveBeenCalledWith(clearCreatedPersonalAccessTokenPlaintext());
    expect(store.dispatch).toHaveBeenCalledWith(clearPersonalAccessTokensError());
  });
});
