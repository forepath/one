import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleGitAccountsFacade,
  GIT_ACCOUNT_PROVIDERS,
  type GitAccount,
  type GitAccountProvider,
  type GitLinkError,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcConfirmDialogComponent,
  FpcEmptyStateComponent,
  FpcListComponent,
  FpcListItemComponent,
  FpcPageHeaderComponent,
  FpcPanelComponent,
  FpcPanelGridComponent,
  FpcSpinnerComponent,
} from '@forepath/shared/frontend/ui-components';

import { GIT_PROVIDER_ICON, gitProviderLabel } from '../git/git-format';

/** What the OAuth callback reported (`?confirm=<nonce>`, `?error=<code>`; older control planes `?linked=<provider>`). */
export interface GitLinkReturn {
  linked: GitAccountProvider | null;
  /** The readable reason for the error code. */
  error: string | null;
  /** The pending link to confirm (only a plain token is accepted). */
  confirm?: string | null;
}

/** Nonces are opaque URL-safe tokens; anything else in `?confirm=` is ignored. */
const NONCE = /^[A-Za-z0-9_-]{8,256}$/;

/** The message for a callback error code (`GitLinkError`); unknown codes get a generic one. */
export function gitLinkErrorMessage(code: string): string {
  switch (code as GitLinkError) {
    case 'denied':
      return $localize`:@@lwConsoleGitAccounts-errorDenied:The authorization was denied at the provider.`;
    case 'invalid-state':
      return $localize`:@@lwConsoleGitAccounts-errorState:The link request expired or was already used. Start linking again.`;
    case 'not-configured':
      return $localize`:@@lwConsoleGitAccounts-errorNotConfigured:Account linking isn't configured for this provider on the cluster.`;
    case 'exchange-failed':
      return $localize`:@@lwConsoleGitAccounts-errorExchange:The provider couldn't confirm the account. Try again later.`;
    case 'already-linked':
      return $localize`:@@lwConsoleGitAccounts-errorAlreadyLinked:This Git account is already linked to another Loadweaver user.`;
    default:
      return $localize`:@@lwConsoleGitAccounts-errorUnknown:The account couldn't be linked.`;
  }
}

/** Reads the return parameters: a known provider, or an error code turned into a message (never shown raw). */
export function gitLinkReturnOf(query: { get(name: string): string | null }): GitLinkReturn {
  const linked = query.get('linked');
  const error = query.get('error');

  const confirm = query.get('confirm');

  return {
    linked: (GIT_ACCOUNT_PROVIDERS as readonly string[]).includes(linked ?? '') ? (linked as GitAccountProvider) : null,
    error: error ? gitLinkErrorMessage(error) : null,
    confirm: confirm && NONCE.test(confirm) ? confirm : null,
  };
}

/**
 * Linked Git accounts (3.30): the plan bot acts on PR comments (`loadweaver apply`, …) only for Git accounts linked to
 * a Loadweaver user, with that user's roles. Linking goes through the provider's OAuth (only the provider's user id
 * and login are kept); the provider sends the browser back here with `?confirm=<nonce>` (the found account waits until
 * the same user confirms it here) or `?error=`.
 */
@Component({
  selector: 'loadweaver-git-accounts-page',
  imports: [
    CommonModule,
    FpcAlertComponent,
    FpcButtonComponent,
    FpcConfirmDialogComponent,
    FpcEmptyStateComponent,
    FpcListComponent,
    FpcListItemComponent,
    FpcPageHeaderComponent,
    FpcPanelComponent,
    FpcPanelGridComponent,
    FpcSpinnerComponent,
  ],
  templateUrl: './git-accounts-page.component.html',
  standalone: true,
})
export class LoadweaverGitAccountsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleGitAccountsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly accounts = toSignal(this.facade.accounts$, { initialValue: [] as GitAccount[] });
  readonly loading = toSignal(this.facade.loading$, { initialValue: false });
  readonly error = toSignal(this.facade.error$, { initialValue: null });
  readonly unavailable = toSignal(this.facade.unavailable$, { initialValue: false });
  readonly linking = toSignal(this.facade.linking$, { initialValue: null });
  readonly unlinking = toSignal(this.facade.unlinking$, { initialValue: null });
  readonly changeError = toSignal(this.facade.changeError$, { initialValue: null });
  readonly pendingLink = toSignal(this.facade.pendingLink$, { initialValue: null });
  readonly pendingLinkState = toSignal(this.facade.pendingLinkState$, { initialValue: 'idle' as const });
  readonly pendingLinkError = toSignal(this.facade.pendingLinkError$, { initialValue: null });
  readonly linkConfirmed = toSignal(this.facade.linkConfirmed$, { initialValue: null });

  readonly returned = signal<GitLinkReturn>({ linked: null, error: null });
  /** Why the pending link couldn't be confirmed, readable. */
  readonly pendingErrorMessage = computed(() => {
    const error = this.pendingLinkError();

    if (!error) return null;

    if (error.code === 'expired')
      return $localize`:@@lwConsoleGitAccounts-confirmExpired:The link request expired or is unknown. Start linking again.`;

    return error.code === 'already-linked' ? gitLinkErrorMessage('already-linked') : error.message;
  });
  readonly unlinkFor = signal<GitAccount | null>(null);
  /** Providers without a linked account (one account per provider). */
  readonly linkable = computed(() =>
    GIT_ACCOUNT_PROVIDERS.filter((p) => !this.accounts().some((a) => a.provider === p)),
  );

  readonly providerIcon = GIT_PROVIDER_ICON;
  readonly providerLabel = gitProviderLabel;

  readonly title = $localize`:@@lwConsoleGitAccounts-title:Linked Git accounts`;
  readonly accountsTitle = $localize`:@@lwConsoleGitAccounts-accounts:Accounts`;
  readonly unlinkTitle = $localize`:@@lwConsoleGitAccounts-unlinkTitle:Unlink the account?`;
  readonly unlinkMessage = $localize`:@@lwConsoleGitAccounts-unlinkMessage:Plan bot commands from this Git account are refused until it is linked again.`;
  readonly unlinkConfirm = $localize`:@@lwConsoleGitAccounts-unlinkConfirm:Unlink`;
  readonly keepLabel = $localize`:@@lwConsoleGitAccounts-keep:Keep`;

  ngOnInit(): void {
    this.facade.load();
    this.facade.clearPendingLink();
    this.destroyRef.onDestroy(() => this.facade.clearPendingLink());
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      const returned = gitLinkReturnOf(query);

      if (!returned.linked && !returned.error && !returned.confirm && !query.has('confirm')) return;

      if (returned.confirm) this.facade.loadPendingLink(returned.confirm);

      // A malformed nonce is treated like an expired one.
      this.returned.set({
        linked: returned.linked,
        error:
          returned.error ??
          (returned.confirm ? null : query.has('confirm') ? gitLinkErrorMessage('invalid-state') : null),
      });
      // The parameters are read once; a reload shouldn't repeat the message.
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    });
  }

  link(provider: GitAccountProvider): void {
    this.facade.link(provider);
  }

  dismissReturned(): void {
    this.returned.set({ linked: null, error: null });
  }

  confirmLink(): void {
    const pending = this.pendingLink();

    if (pending) this.facade.confirmPendingLink(pending.nonce);
  }

  cancelLink(): void {
    const pending = this.pendingLink();

    if (pending) this.facade.cancelPendingLink(pending.nonce);
  }

  dismissPendingResult(): void {
    this.facade.clearPendingLink();
  }

  dismissChangeError(): void {
    this.facade.clearError();
  }

  confirmUnlink(): void {
    const account = this.unlinkFor();

    this.unlinkFor.set(null);

    if (account) this.facade.unlink(account.id);
  }
}
