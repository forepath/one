import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import type {
  CreatePersonalAccessTokenDto,
  PersonalAccessTokenResponseDto,
  PersonalAccessTokenScopeDto,
  UpdatePersonalAccessTokenDto,
} from '../../types/personal-access-token.types';

import {
  clearCreatedPersonalAccessTokenPlaintext,
  clearPersonalAccessTokensError,
  createPersonalAccessToken,
  loadPersonalAccessTokenScopes,
  loadPersonalAccessTokens,
  revokePersonalAccessToken,
  updatePersonalAccessToken,
} from './personal-access-tokens.actions';
import {
  selectLastCreatedPersonalAccessTokenPlaintext,
  selectPersonalAccessTokenScopes,
  selectPersonalAccessTokenScopesError,
  selectPersonalAccessTokenScopesLoading,
  selectPersonalAccessTokens,
  selectPersonalAccessTokensError,
  selectPersonalAccessTokensLoading,
  selectPersonalAccessTokensRevoking,
  selectPersonalAccessTokensSaving,
} from './personal-access-tokens.selectors';

@Injectable({
  providedIn: 'root',
})
export class PersonalAccessTokensFacade {
  private readonly store = inject(Store);

  readonly tokens$: Observable<PersonalAccessTokenResponseDto[]> = this.store.select(selectPersonalAccessTokens);
  readonly loading$: Observable<boolean> = this.store.select(selectPersonalAccessTokensLoading);
  readonly error$: Observable<string | null> = this.store.select(selectPersonalAccessTokensError);
  readonly saving$: Observable<boolean> = this.store.select(selectPersonalAccessTokensSaving);
  readonly revoking$: Observable<boolean> = this.store.select(selectPersonalAccessTokensRevoking);
  readonly scopes$: Observable<PersonalAccessTokenScopeDto[]> = this.store.select(selectPersonalAccessTokenScopes);
  readonly scopesLoading$: Observable<boolean> = this.store.select(selectPersonalAccessTokenScopesLoading);
  readonly scopesError$: Observable<string | null> = this.store.select(selectPersonalAccessTokenScopesError);
  readonly lastCreatedPlaintext$: Observable<string | null> = this.store.select(
    selectLastCreatedPersonalAccessTokenPlaintext,
  );

  load(): void {
    this.store.dispatch(loadPersonalAccessTokens());
  }

  loadScopes(): void {
    this.store.dispatch(loadPersonalAccessTokenScopes());
  }

  create(dto: CreatePersonalAccessTokenDto): void {
    this.store.dispatch(createPersonalAccessToken({ dto }));
  }

  update(id: string, dto: UpdatePersonalAccessTokenDto): void {
    this.store.dispatch(updatePersonalAccessToken({ id, dto }));
  }

  revoke(id: string): void {
    this.store.dispatch(revokePersonalAccessToken({ id }));
  }

  clearCreatedPlaintext(): void {
    this.store.dispatch(clearCreatedPersonalAccessTokenPlaintext());
  }

  clearError(): void {
    this.store.dispatch(clearPersonalAccessTokensError());
  }
}
