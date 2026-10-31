import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { GitAccountProvider } from '../../types/git.types';
import {
  cancelPendingGitLink,
  clearGitAccountError,
  clearPendingGitLink,
  confirmPendingGitLink,
  linkGitAccount,
  loadGitAccounts,
  loadPendingGitLink,
  unlinkGitAccount,
} from './git-accounts.actions';
import {
  selectGitAccountChangeError,
  selectGitAccountLinking,
  selectGitAccounts,
  selectGitAccountsError,
  selectGitAccountsLoading,
  selectGitAccountsUnavailable,
  selectGitAccountUnlinking,
  selectGitLinkConfirmed,
  selectGitPendingLink,
  selectGitPendingLinkError,
  selectGitPendingLinkState,
} from './git-accounts.selectors';

/** The Git accounts linked to the signed-in user (3.30: PR commands act as the linked user). */
@Injectable()
export class ConsoleGitAccountsFacade {
  private readonly store = inject(Store);

  readonly accounts$ = this.store.select(selectGitAccounts);
  readonly loading$ = this.store.select(selectGitAccountsLoading);
  readonly error$ = this.store.select(selectGitAccountsError);
  readonly unavailable$ = this.store.select(selectGitAccountsUnavailable);
  readonly linking$ = this.store.select(selectGitAccountLinking);
  readonly unlinking$ = this.store.select(selectGitAccountUnlinking);
  readonly changeError$ = this.store.select(selectGitAccountChangeError);
  readonly pendingLink$ = this.store.select(selectGitPendingLink);
  readonly pendingLinkState$ = this.store.select(selectGitPendingLinkState);
  readonly pendingLinkError$ = this.store.select(selectGitPendingLinkError);
  readonly linkConfirmed$ = this.store.select(selectGitLinkConfirmed);

  load(): void {
    this.store.dispatch(loadGitAccounts());
  }

  link(provider: GitAccountProvider): void {
    this.store.dispatch(linkGitAccount({ provider }));
  }

  unlink(id: string): void {
    this.store.dispatch(unlinkGitAccount({ id }));
  }

  /** Reads the link the OAuth callback left waiting (`?confirm=<nonce>`). */
  loadPendingLink(nonce: string): void {
    this.store.dispatch(loadPendingGitLink({ nonce }));
  }

  confirmPendingLink(nonce: string): void {
    this.store.dispatch(confirmPendingGitLink({ nonce }));
  }

  cancelPendingLink(nonce: string): void {
    this.store.dispatch(cancelPendingGitLink({ nonce }));
  }

  clearPendingLink(): void {
    this.store.dispatch(clearPendingGitLink());
  }

  clearError(): void {
    this.store.dispatch(clearGitAccountError());
  }
}
