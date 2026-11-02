import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitAccountsFacade,
  GIT_ACCOUNT_PROVIDERS,
  type AccessMe,
  type GitAccount,
  type GitAccountProvider,
  type GitLinkError,
} from '@forepath/loadweaver/frontend/data-access-console';
import {
  FpcAlertComponent,
  FpcButtonComponent,
  FpcButtonGroupComponent,
  FpcConfirmDialogComponent,
  fpcCopyText,
  FpcDataTableComponent,
  FpcEmptyStateComponent,
  FpcPageHeaderComponent,
  FpcSectionRowComponent,
  FpcTableCellDirective,
  type FpcMenuItem,
  type FpcTableColumn,
} from '@forepath/shared/frontend/ui-components';

import { GIT_PROVIDER_ICON, gitProviderLabel } from '../git/git-format';
import { filterBySearch } from '../list-search';
import { dlCopyIdItem } from '../section/data-list';
import { LoadweaverLaneComponent } from '../section/lane.component';

/** What the OAuth callback reported (`?confirm=<nonce>`, `?error=<code>`; older control planes `?linked=<provider>`). */
export interface GitLinkReturn {
  linked: GitAccountProvider | null;
  /** The readable reason for the error code. */
  error: string | null;
  /** The pending link to confirm (only a plain token is accepted). */
  confirm?: string | null;
}

/**
 * Why linked Git accounts can't be used here (3.41), or null: natively never; in fleet mode the accounts are the
 * signed person's on the open cluster, so a cluster must be open and verify this fleet's identity claims.
 */
export function gitAccountsFleetBlock(
  fleetMode: boolean,
  activeCluster: string | null,
  me: AccessMe | null | undefined,
): 'no-cluster' | 'no-identity' | null {
  if (!fleetMode) return null;

  if (!activeCluster) return 'no-cluster';

  return me && !me.fleetIdentity ? 'no-identity' : null;
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
    FpcButtonGroupComponent,
    FpcConfirmDialogComponent,
    FpcDataTableComponent,
    FpcEmptyStateComponent,
    FpcPageHeaderComponent,
    FpcSectionRowComponent,
    FpcTableCellDirective,
    LoadweaverLaneComponent,
  ],
  templateUrl: './git-accounts-page.component.html',
  // The notice area is pinned above the lanes and capped, so a stack of alerts never pushes the list away.
  styles: `
    .lw-git-accounts__notices {
      flex: 0 0 auto;
      max-height: 40vh;
      overflow-y: auto;
    }
  `,
  standalone: true,
})
export class LoadweaverGitAccountsPageComponent implements OnInit {
  private readonly facade = inject(ConsoleGitAccountsFacade);
  private readonly access = inject(ConsoleAccessFacade);
  private readonly endpoints = inject(ConsoleEndpointService);
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
  private readonly me = toSignal(this.access.me$, { initialValue: null });

  /** Fleet mode (3.41): the signed person's accounts on the open cluster; else why not (a hint instead of the list). */
  readonly fleetMode = this.endpoints.fleetMode;
  readonly fleetBlock = computed(() =>
    gitAccountsFleetBlock(this.fleetMode, this.endpoints.activeClusterId(), this.me()),
  );
  /** Fleet mode: the person is known once the grant (and the cluster's identity verification) has loaded. */
  private readonly ready = computed(() => !this.fleetMode || (!!this.me() && this.fleetBlock() === null));
  readonly fleetHint = computed(() =>
    this.fleetBlock() === 'no-cluster'
      ? $localize`:@@lwConsoleGitAccounts-fleetNoCluster:Linked Git accounts belong to a cluster. Open a cluster first; your accounts are linked there for you.`
      : $localize`:@@lwConsoleGitAccounts-fleetNoIdentity:Through the fleet your Git accounts are linked for you personally, so the cluster has to verify this fleet's identity first. A fleet admin establishes trust on the fleet's cluster page; until then link your accounts in the cluster's own console.`,
  );

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
  /** Lane search (shown beyond 10 accounts). */
  readonly search = signal('');
  readonly visible = computed(() =>
    filterBySearch(this.accounts(), this.search(), (a) => [a.login, this.providerLabel(a.provider)]),
  );
  /** Providers without a linked account (one account per provider). */
  readonly linkable = computed(() =>
    GIT_ACCOUNT_PROVIDERS.filter((p) => !this.accounts().some((a) => a.provider === p)),
  );

  readonly providerIcon = GIT_PROVIDER_ICON;
  readonly providerLabel = gitProviderLabel;
  readonly providerIconOf = (account: GitAccount) => GIT_PROVIDER_ICON[account.provider];
  /** 3.38 D1: State · Account (login) · provider · linked. */
  readonly columns: FpcTableColumn<GitAccount>[] = [
    {
      id: 'state',
      label: $localize`:@@lwConsoleGitAccounts-colState:Status`,
      type: 'state',
      state: () => ({ label: $localize`:@@lwConsoleGitAccounts-linkedAt:Linked`, tone: 'success', icon: 'link-45deg' }),
    },
    {
      id: 'login',
      label: $localize`:@@lwConsoleGitAccounts-colAccount:Account`,
      value: (account) => account.login,
      required: true,
      priority: 1,
    },
    {
      id: 'provider',
      label: $localize`:@@lwConsoleGitAccounts-colProvider:Provider`,
      value: (account) => gitProviderLabel(account.provider),
      priority: 1,
    },
    {
      id: 'linked',
      label: $localize`:@@lwConsoleGitAccounts-linkedAt:Linked`,
      value: (account) => account.createdAt,
      priority: 2,
    },
  ];
  readonly rowMenu = (): FpcMenuItem[] => [
    { id: 'unlink', label: this.unlinkLabel, icon: 'trash', danger: true },
    dlCopyIdItem(),
  ];

  readonly title = $localize`:@@lwConsoleGitAccounts-title:Linked Git accounts`;
  readonly accountsTitle = $localize`:@@lwConsoleGitAccounts-accounts:Accounts`;
  readonly unlinkLabel = $localize`:@@lwConsoleGitAccounts-unlink:Unlink`;
  readonly unlinkTitle = $localize`:@@lwConsoleGitAccounts-unlinkTitle:Unlink the account?`;
  readonly unlinkMessage = $localize`:@@lwConsoleGitAccounts-unlinkMessage:Plan bot commands from this Git account are refused until it is linked again.`;
  readonly unlinkConfirm = $localize`:@@lwConsoleGitAccounts-unlinkConfirm:Unlink`;
  readonly keepLabel = $localize`:@@lwConsoleGitAccounts-keep:Keep`;
  readonly searchLabel = $localize`:@@lwConsoleGitAccounts-search:Search Git accounts`;
  readonly loadingLabel = $localize`:@@lwConsoleGitAccounts-loading:Loading Git accounts`;
  readonly pendingLoadingLabel = $localize`:@@lwConsoleGitAccounts-pendingLoading:Loading the link request`;

  /** Label of a provider's link button (icon-only in the lane header). */
  linkLabel(provider: GitAccountProvider): string {
    return $localize`:@@lwConsoleGitAccounts-link:Link ${gitProviderLabel(provider)}:provider: account`;
  }

  constructor() {
    // Natively at once; in fleet mode once the person is verified on the open cluster (never as the service user).
    effect(() => {
      if (this.ready()) untracked(() => this.facade.load());
    });
  }

  ngOnInit(): void {
    if (this.fleetMode) this.access.load();

    this.facade.clearPendingLink();
    this.destroyRef.onDestroy(() => this.facade.clearPendingLink());
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((query) => {
      const returned = gitLinkReturnOf(query);

      if (!returned.linked && !returned.error && !returned.confirm && !query.has('confirm')) return;

      // Fleet mode: the pending link is the person's on the cluster; without a verified person it can't be read.
      if (returned.confirm && this.fleetBlock() === null) this.facade.loadPendingLink(returned.confirm);

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

  onRowAction(account: GitAccount, action: string): void {
    if (action === 'unlink') this.unlinkFor.set(account);
    else if (action === 'copy-id') fpcCopyText(account.id);
  }

  confirmUnlink(): void {
    const account = this.unlinkFor();

    this.unlinkFor.set(null);

    if (account) this.facade.unlink(account.id);
  }
}
