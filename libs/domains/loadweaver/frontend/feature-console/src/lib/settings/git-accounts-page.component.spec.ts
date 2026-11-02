import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
  ConsoleGitAccountsFacade,
  type AccessMe,
  type GitAccount,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of } from 'rxjs';

import { accessStub, facadeStub } from '../testing';
import {
  gitAccountsFleetBlock,
  gitLinkReturnOf,
  LoadweaverGitAccountsPageComponent,
} from './git-accounts-page.component';

const account: GitAccount = {
  id: 'a1',
  provider: 'github',
  providerUserId: '42',
  login: 'octocat',
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('LoadweaverGitAccountsPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverGitAccountsPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let navigate: jest.Mock;

  async function setup(
    query: Record<string, string> = {},
    accounts: GitAccount[] = [account],
    fleet?: { cluster: string | null; me: AccessMe | null },
  ) {
    facade = facadeStub(
      {
        accounts$: accounts,
        loading$: false,
        error$: null,
        unavailable$: false,
        linking$: null,
        unlinking$: null,
        changeError$: null,
        pendingLink$: null,
        pendingLinkState$: 'idle',
        pendingLinkError$: null,
        linkConfirmed$: null,
      },
      [
        'load',
        'link',
        'unlink',
        'clearError',
        'loadPendingLink',
        'confirmPendingLink',
        'cancelPendingLink',
        'clearPendingLink',
      ],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverGitAccountsPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(query)) } },
        { provide: ConsoleGitAccountsFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub(fleet?.me ?? null) },
        ...(fleet
          ? [
              {
                provide: ConsoleEndpointService,
                useValue: { fleetMode: true, activeClusterId: signal(fleet.cluster).asReadonly() },
              },
            ]
          : []),
      ],
    }).compileComponents();

    navigate = jest.fn().mockResolvedValue(true);
    TestBed.inject(Router).navigate = navigate;
    fixture = TestBed.createComponent(LoadweaverGitAccountsPageComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('reads the OAuth return parameters', () => {
    expect(gitLinkReturnOf(convertToParamMap({ linked: 'gitlab' }))).toEqual({
      linked: 'gitlab',
      error: null,
      confirm: null,
    });
    expect(gitLinkReturnOf(convertToParamMap({ linked: 'bitbucket' }))).toEqual({
      linked: null,
      error: null,
      confirm: null,
    });
    expect(gitLinkReturnOf(convertToParamMap({ confirm: 'n0nce_ABC-123' })).confirm).toBe('n0nce_ABC-123');
    expect(gitLinkReturnOf(convertToParamMap({ confirm: '../../etc' })).confirm).toBeNull();
    expect(gitLinkReturnOf(convertToParamMap({ error: 'already-linked' })).error).toContain('another Loadweaver user');
    expect(gitLinkReturnOf(convertToParamMap({ error: '<script>' })).error).toBe("The account couldn't be linked.");
  });

  it('lists linked accounts and links the missing provider', async () => {
    await setup();

    expect(facade['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="git-accounts-list"]')?.textContent).toContain('octocat');
    expect(fixture.componentInstance.linkable()).toEqual(['gitlab']);
    expect(el().querySelector('[data-testid="git-accounts-link-github"]')).toBeNull();
    // Link buttons are icon-only in the lane header, labelled per provider (3.38).
    expect(el().querySelector('[data-testid="git-accounts-link-gitlab"] button')?.getAttribute('aria-label')).toBe(
      'Link GitLab account',
    );
    // 3.38 D1: the accounts are a data table (State column, login, provider).
    expect(el().querySelector('[data-testid="git-accounts-list"] [data-testid="fpc-data-table-state"]')).not.toBeNull();

    fixture.componentInstance.link('gitlab');
    expect(facade['link']).toHaveBeenCalledWith('gitlab');
  });

  it('unlinks after confirmation', async () => {
    await setup();

    const component = fixture.componentInstance;
    // Unlink sits in the row's ⋮ (3.38 D8).
    expect(component.rowMenu().map((item) => item.id)).toEqual(['unlink', 'copy-id']);
    component.onRowAction(account, 'unlink');
    expect(component.unlinkFor()).toBe(account);
    component.confirmUnlink();
    expect(facade['unlink']).toHaveBeenCalledWith('a1');
    expect(component.unlinkFor()).toBeNull();
  });

  it('shows the result of the OAuth round trip once and clears the URL', async () => {
    await setup({ linked: 'github' });

    expect(el().querySelector('[data-testid="git-accounts-linked"]')?.textContent).toContain('GitHub');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {}, replaceUrl: true }));

    TestBed.resetTestingModule();
    await setup({ error: 'invalid-state' });
    expect(el().querySelector('[data-testid="git-accounts-error"]')?.textContent).toContain('expired');
  });

  it('says when the control plane offers no account linking', async () => {
    await setup({}, []);

    (facade['unavailable$'] as BehaviorSubject<unknown>).next(true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-accounts-unavailable"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="git-accounts-link"]')).toBeNull();
  });

  const pending = {
    nonce: 'n0nce_ABC-123',
    provider: 'gitlab' as const,
    login: 'tanuki',
    providerUserId: '7',
    expiresAt: '2026-10-18T10:10:00.000Z',
  };

  it('asks before linking the account the OAuth callback found, then confirms it', async () => {
    await setup({ confirm: 'n0nce_ABC-123' });

    expect(facade['loadPendingLink']).toHaveBeenCalledWith('n0nce_ABC-123');
    // The nonce isn't kept in the URL.
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: {}, replaceUrl: true }));

    (facade['pendingLink$'] as BehaviorSubject<unknown>).next(pending);
    (facade['pendingLinkState$'] as BehaviorSubject<unknown>).next('ready');
    fixture.detectChanges();

    const prompt = el().querySelector('[data-testid="git-accounts-confirm"]');

    expect(prompt?.textContent).toContain('tanuki');
    expect(prompt?.textContent).toContain('GitLab');
    expect(facade['confirmPendingLink']).not.toHaveBeenCalled();

    (el().querySelector('[data-testid="git-accounts-confirm-link"] button') as HTMLButtonElement).click();
    expect(facade['confirmPendingLink']).toHaveBeenCalledWith('n0nce_ABC-123');

    (facade['pendingLink$'] as BehaviorSubject<unknown>).next(null);
    (facade['pendingLinkState$'] as BehaviorSubject<unknown>).next('idle');
    (facade['linkConfirmed$'] as BehaviorSubject<unknown>).next({
      ...account,
      id: 'a2',
      provider: 'gitlab',
      login: 'tanuki',
    });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-accounts-confirm"]')).toBeNull();
    expect(el().querySelector('[data-testid="git-accounts-confirmed"]')?.textContent).toContain('tanuki');

    fixture.destroy();
    expect(facade['clearPendingLink']).toHaveBeenCalled();
  });

  it('cancels a pending link', async () => {
    await setup({ confirm: 'n0nce_ABC-123' });

    (facade['pendingLink$'] as BehaviorSubject<unknown>).next(pending);
    (facade['pendingLinkState$'] as BehaviorSubject<unknown>).next('ready');
    fixture.detectChanges();

    (el().querySelector('[data-testid="git-accounts-confirm-cancel"] button') as HTMLButtonElement).click();
    expect(facade['cancelPendingLink']).toHaveBeenCalledWith('n0nce_ABC-123');
    expect(facade['confirmPendingLink']).not.toHaveBeenCalled();
  });

  it('explains an expired link request and an account linked to someone else', async () => {
    await setup({ confirm: 'n0nce_ABC-123' });

    (facade['pendingLinkError$'] as BehaviorSubject<unknown>).next({ code: 'expired', message: 'Not Found' });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-accounts-confirm-error"]')?.textContent).toContain(
      'expired or is unknown',
    );

    (facade['pendingLinkError$'] as BehaviorSubject<unknown>).next({ code: 'already-linked', message: 'conflict' });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-accounts-confirm-error"]')?.textContent).toContain(
      'already linked to another Loadweaver user',
    );

    (facade['pendingLinkError$'] as BehaviorSubject<unknown>).next({ code: 'failed', message: 'boom' });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-accounts-confirm-error"]')?.textContent).toContain('boom');

    fixture.componentInstance.dismissPendingResult();
    expect(facade['clearPendingLink']).toHaveBeenCalled();
  });

  it('ignores a malformed nonce and says the request is invalid', async () => {
    await setup({ confirm: 'bad nonce' });

    expect(facade['loadPendingLink']).not.toHaveBeenCalled();
    expect(el().querySelector('[data-testid="git-accounts-error"]')?.textContent).toContain('expired');
  });

  describe('fleet mode (3.41): the signed person’s accounts on the open cluster', () => {
    const CLUSTER = '6f1c1b0e-0000-4000-8000-000000000001';
    const verified: AccessMe = {
      userId: 'fleet:f1:alice',
      clusterRole: null,
      projects: { shop: 'viewer' },
      fleetIdentity: true,
    };
    const unverified: AccessMe = {
      userId: null,
      clusterRole: null,
      projects: { shop: 'viewer' },
      fleetIdentity: false,
    };

    it('decides when the page can be used', () => {
      expect(gitAccountsFleetBlock(false, null, null)).toBeNull();
      expect(gitAccountsFleetBlock(true, null, verified)).toBe('no-cluster');
      expect(gitAccountsFleetBlock(true, CLUSTER, unverified)).toBe('no-identity');
      expect(gitAccountsFleetBlock(true, CLUSTER, verified)).toBeNull();
    });

    it('lists and links for a verified person, project grants included', async () => {
      await setup({ confirm: 'n0nce_ABC-123' }, [account], { cluster: CLUSTER, me: verified });

      expect(facade['load']).toHaveBeenCalled();
      expect(facade['loadPendingLink']).toHaveBeenCalledWith('n0nce_ABC-123');
      expect(el().querySelector('[data-testid="git-accounts-fleet-hint"]')).toBeNull();
      expect(el().querySelector('[data-testid="git-accounts-list"]')?.textContent).toContain('octocat');
    });

    it('explains instead of listing when the cluster doesn’t verify the fleet, or no cluster is open', async () => {
      await setup({}, [account], { cluster: CLUSTER, me: unverified });

      expect(facade['load']).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="git-accounts-fleet-hint"]')?.textContent).toContain(
        "verify this fleet's identity",
      );
      expect(el().querySelector('[data-testid="git-accounts-list"]')).toBeNull();

      TestBed.resetTestingModule();
      await setup({}, [account], { cluster: null, me: null });
      expect(facade['load']).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="git-accounts-fleet-hint"]')?.textContent).toContain('Open a cluster');
    });
  });
});
