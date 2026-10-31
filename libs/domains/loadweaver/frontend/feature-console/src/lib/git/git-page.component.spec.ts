import { signal, type Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  ConsoleEndpointService,
  ConsoleGitFacade,
  GitService,
  type GitCommit,
  type GitConnection,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { LW_SECTION_SCOPE } from '../section/section-scope';
import { accessStub, facadeStub, gitStub, testGitConnection } from '../testing';
import { LoadweaverGitConnectionPageComponent } from './git-connection-page.component';
import { LoadweaverGitPageComponent, routeConnectionId } from './git-page.component';
import { LoadweaverGitSopsPageComponent } from './git-sops-page.component';

const shop = testGitConnection({
  lastSyncedCommit: 'abcdef0123456789',
  lastSyncAt: '2026-10-02T10:00:00.000Z',
  hostKey: null,
});
const cluster = testGitConnection({
  id: 'c0000000-0000-4000-8000-000000000000',
  project: null,
  path: '',
  mode: 'authoritative',
  repoUrl: 'git@gitlab.com:acme/cluster.git',
  provider: 'gitlab',
  credentials: 'secret://ops/deploy-key',
  hostKey: 'gitlab.com ssh-ed25519 AAAA',
  lastError: 'fetch failed: host key changed',
});
const commits: GitCommit[] = [
  {
    id: 'k1',
    sha: 'abcdef0123456789',
    ref: 'refs/heads/main',
    kind: 'push',
    planId: '3f2a1b4c-0000-4000-8000-000000000001',
    author: 'Dev <dev@example.com>',
    message: 'Scale web',
    state: 'pending',
    reportedState: 'pending',
    reason: null,
    prUrl: null,
    prNumber: null,
    createdAt: '2026-10-02T10:00:00.000Z',
  },
  {
    id: 'k2',
    sha: '1234567890abcdef',
    ref: 'refs/heads/main',
    kind: 'push',
    planId: null,
    author: 'Dev <dev@example.com>',
    message: 'Add token',
    state: 'rejected',
    reportedState: null,
    reason: 'shop/app.yaml:12: github-token',
    prUrl: null,
    prNumber: null,
    createdAt: '2026-10-01T10:00:00.000Z',
  },
];

describe('Git (list | connection detail | SOPS)', () => {
  afterEach(() => jest.restoreAllMocks());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fixture: ComponentFixture<any>;
  let git: ReturnType<typeof gitStub>;
  let management: ReturnType<typeof facadeStub>;
  const gitService = { sync: jest.fn() };

  async function setup(
    me: AccessMe,
    connections: GitConnection[] = [cluster, shop],
    route: { params?: Record<string, string>; query?: Record<string, string> } = {},
    component: Type<unknown> = route.params?.['id'] ? LoadweaverGitConnectionPageComponent : LoadweaverGitPageComponent,
    scope: Record<string, string> | null = null,
    fleetMode = false,
  ) {
    git = gitStub(connections, { commits$: { [shop.id]: commits } });
    (git['webhookUrl'] as jest.Mock).mockImplementation((c: GitConnection) => `https://lw.example${c.webhookPath}`);
    management = facadeStub({ projects$: ['shop', 'web'] }, ['loadProjects']);

    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap(route.params ?? {})),
            queryParamMap: of(convertToParamMap(route.query ?? {})),
          },
        },
        { provide: ConsoleGitFacade, useValue: git },
        { provide: GitService, useValue: gitService },
        { provide: ConsoleAccessManagementFacade, useValue: management },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
        ...(scope ? [{ provide: LW_SECTION_SCOPE, useValue: { params: signal(scope) } }] : []),
        ...(fleetMode ? [{ provide: ConsoleEndpointService, useValue: { fleetMode: true } }] : []),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(component);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const projectAdmin: AccessMe = { userId: 'u', clusterRole: null, projects: { shop: 'admin', web: 'admin' } };
  const viewer: AccessMe = { userId: 'v', clusterRole: null, projects: { shop: 'viewer' } };

  it('reads the connection from /git/<id> or ?connection=', () => {
    const map = (values: Record<string, string>) => convertToParamMap(values);

    expect(routeConnectionId(map({ id: 'a' }), map({}))).toBe('a');
    expect(routeConnectionId(map({}), map({ connection: 'b' }))).toBe('b');
    expect(routeConnectionId(map({}), map({}))).toBeNull();
  });

  it('lists the connections with status', async () => {
    await setup(projectAdmin, [cluster, shop]);

    expect(git['load']).toHaveBeenCalled();

    const list = el().querySelector('[data-testid="git-connections"]')?.textContent ?? '';

    expect(list).toContain('Cluster scope');
    expect(list).toContain('git@gitlab.com:acme/cluster.git');
    expect(
      el()
        .querySelector('[data-testid="git-connections"] [data-testid="fpc-data-table-state"]')
        ?.getAttribute('aria-label'),
    ).toBe('Error');
    expect(list).toContain('abcdef01');

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.select(shop);
    expect(navigate).toHaveBeenCalledWith(['/delivery/git', shop.id]);
  });

  it('syncs the selected connections one by one, only scopes the caller administers', async () => {
    await setup(projectAdmin, [cluster, shop]);

    const component = fixture.componentInstance as LoadweaverGitPageComponent;

    gitService.sync.mockReset().mockImplementation(() => throwError(() => ({ status: 403 })));
    component.selected.set([cluster.id, shop.id]);
    // The cluster scope is not this project admin's: only `shop` is synced.
    expect(component.syncable().map((c) => c.id)).toEqual([shop.id]);
    await component.syncSelected();
    expect(gitService.sync).toHaveBeenCalledTimes(1);
    expect(gitService.sync).toHaveBeenCalledWith(shop.id);
    expect(component.bulkResult()?.tone).toBe('danger');
    expect(component.selected()).toEqual([]);
  });

  it('redirects the old ?connection= deep link to the detail route', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await setup(projectAdmin, [cluster, shop], { query: { connection: shop.id } });

    expect(navigate).toHaveBeenCalledWith(['/delivery/git', shop.id], { replaceUrl: true });
  });

  it('shows the routed connection with facts, webhook and its commits table', async () => {
    await setup(projectAdmin, [cluster, shop], { params: { id: shop.id } });

    expect(git['loadCommits']).toHaveBeenCalledWith(shop.id);

    const table = el().querySelector('[data-testid="git-commits"]');

    expect(table?.tagName.toLowerCase()).toBe('fpc-data-table');
    expect(table?.querySelector('a[href="https://github.com/acme/infra/commit/abcdef0123456789"]')).not.toBeNull();
    expect(table?.querySelector('a[href="/activity/plans/3f2a1b4c-0000-4000-8000-000000000001"]')).not.toBeNull();
    expect(table?.querySelector('[data-testid="git-commit-reason"]')?.textContent).toContain('github-token');
    expect(el().querySelector('[data-testid="git-detail"] fpc-key-value-list')).not.toBeNull();
    expect(el().querySelector('dl.row')).toBeNull();
    expect(el().querySelector('[data-testid="git-back"]')).not.toBeNull();
    expect((el().querySelector('[data-testid="git-webhook-url"] input') as HTMLInputElement).value).toBe(
      `https://lw.example${shop.webhookPath}`,
    );
  });

  it('embedded in a project tab: only its connection, no header, actions in the strip, no URL writes', async () => {
    const navigate = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await setup(projectAdmin, [cluster, shop], { query: { connection: cluster.id } }, LoadweaverGitPageComponent, {
      project: 'shop',
    });

    expect(fixture.componentInstance.filtered().map((c: GitConnection) => c.id)).toEqual([shop.id]);
    expect(el().querySelector('fpc-page-header')).toBeNull();
    expect(el().querySelector('[data-testid="fpc-data-table-toolbar"] [data-testid="git-refresh"]')).not.toBeNull();
    // `web` is free but not this project's; `shop` is taken: no Connect.
    expect(el().querySelector('[data-testid="git-connect"]')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('searches the connections', async () => {
    await setup(projectAdmin, [cluster, shop]);

    const component = fixture.componentInstance;

    component.search.set('gitlab.com');
    fixture.detectChanges();
    expect(component.filtered().map((c) => c.id)).toEqual([cluster.id]);
    // One data table: State column, scope link to the detail route.
    expect(el().querySelector('[data-testid="git-connections"] a.fpc-data-table__link')?.getAttribute('href')).toBe(
      `/delivery/git/${cluster.id}`,
    );

    component.search.set('nothing');
    fixture.detectChanges();
    expect(
      el().querySelector('[data-testid="git-connections"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
  });

  it('gives project admins the actions on their project and nothing on the cluster scope', async () => {
    await setup(projectAdmin, [cluster, shop], { params: { id: cluster.id } });

    expect(fixture.componentInstance.selected()?.id).toBe(cluster.id);
    expect(el().querySelector('[data-testid="git-actions"]')).toBeNull();
    expect(el().querySelector('[data-testid="git-last-error"]')?.textContent).toContain('host key changed');

    TestBed.resetTestingModule();
    await setup(projectAdmin, [cluster, shop]);
    // The cluster scope isn't theirs; `web` is free.
    expect(fixture.componentInstance.freeScopes()).toEqual(['web']);

    TestBed.resetTestingModule();
    await setup(projectAdmin, [cluster, shop], { params: { id: shop.id } });

    const component = fixture.componentInstance;
    const c = component.selected() as GitConnection;

    expect(el().querySelector('[data-testid="git-actions"]')).not.toBeNull();
    // Export, host key reset and Disconnect sit in More ▾ (3.38: more than 3 actions).
    expect(el().querySelector('[data-testid="git-more"]')).not.toBeNull();

    component.run(c, 'test');
    expect(git['run']).toHaveBeenCalledWith(shop.id, 'test');
    component.run(c, 'sync');
    expect(git['run']).toHaveBeenCalledWith(shop.id, 'sync');
  });

  it('asks before exporting, with an extra warning for force', async () => {
    await setup(projectAdmin, [shop], { params: { id: shop.id } });

    const component = fixture.componentInstance;

    component.openExport(shop);
    component.exportForce.set(true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-export-force-warning"]')).not.toBeNull();

    component.confirmExport();
    expect(git['run']).toHaveBeenCalledWith(shop.id, 'export', true);
    expect(component.exportFor()).toBeNull();

    component.openExport(shop);
    expect(component.exportForce()).toBe(false);
    component.confirmExport();
    expect(git['run']).toHaveBeenLastCalledWith(shop.id, 'export', false);
  });

  it('confirms host key resets and disconnects, and reveals the webhook secret on demand', async () => {
    const router = { navigate: jest.fn().mockResolvedValue(true) };

    await setup(projectAdmin, [shop], { params: { id: shop.id } });
    TestBed.inject(Router).navigate = router.navigate;

    const component = fixture.componentInstance;

    component.resetFor.set(shop);
    component.confirmReset();
    expect(git['run']).toHaveBeenCalledWith(shop.id, 'reset-host-key');

    expect(git['revealWebhookSecret']).not.toHaveBeenCalled();
    component.revealFor.set(shop);
    component.confirmReveal();
    expect(git['revealWebhookSecret']).toHaveBeenCalledWith(shop.id);

    (git['webhookSecret$'] as BehaviorSubject<unknown>).next({ id: shop.id, secret: 'whsec_123' });
    fixture.detectChanges();
    expect((el().querySelector('[data-testid="git-webhook-secret"] input') as HTMLInputElement).value).toBe(
      'whsec_123',
    );

    component.hideSecret();
    expect(git['hideWebhookSecret']).toHaveBeenCalled();

    component.deleteFor.set(shop);
    component.confirmDelete();
    expect(git['remove']).toHaveBeenCalledWith(shop.id);
    expect(router.navigate).toHaveBeenCalledWith(['/delivery/git']);

    fixture.destroy();
    // A secret read on demand never outlives the page.
    expect(git['hideWebhookSecret']).toHaveBeenCalledTimes(2);
  });

  it('rotates the webhook secret only after a confirm and shows the new one once', async () => {
    await setup(projectAdmin, [shop], { params: { id: shop.id } });

    const component = fixture.componentInstance;
    const rotate = el().querySelector('[data-testid="git-rotate-secret"] button') as HTMLButtonElement;

    rotate.click();
    fixture.detectChanges();
    // Asks first: the current secret stops working.
    expect(git['rotateWebhookSecret']).not.toHaveBeenCalled();
    expect(component.rotateFor()).toEqual(shop);
    expect(component.rotateMessage).toContain('stops working immediately');

    component.confirmRotate();
    expect(git['rotateWebhookSecret']).toHaveBeenCalledWith(shop.id);
    expect(component.rotateFor()).toBeNull();

    (git['connections$'] as BehaviorSubject<unknown>).next([{ ...shop, webhookGeneration: 1 }]);
    (git['webhookSecret$'] as BehaviorSubject<unknown>).next({ id: shop.id, secret: 'whsec_new', rotated: true });
    fixture.detectChanges();

    expect((el().querySelector('[data-testid="git-webhook-secret"] input') as HTMLInputElement).value).toBe(
      'whsec_new',
    );
    expect(el().querySelector('[data-testid="git-webhook-rotated"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="git-webhook-generation"]')?.textContent).toContain('1');

    // A plain read isn't announced as a rotation.
    (git['webhookSecret$'] as BehaviorSubject<unknown>).next({ id: shop.id, secret: 'whsec_new' });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-webhook-rotated"]')).toBeNull();
  });

  it('lists the resources an export skipped because they come from SOPS files', async () => {
    await setup(projectAdmin, [shop], { params: { id: shop.id } });

    (git['actionResult$'] as BehaviorSubject<unknown>).next({
      id: shop.id,
      outcome: {
        action: 'export',
        result: {
          commit: 'abcdef0123456789',
          resources: 3,
          changed: true,
          skipped: ['Secret shop/db', 'Secret shop/api'],
        },
      },
    });
    fixture.detectChanges();

    const skipped = el().querySelector('[data-testid="git-export-skipped"]');

    expect(skipped?.textContent).toContain('Secret shop/db');
    expect(skipped?.textContent).toContain('Secret shop/api');

    (git['actionResult$'] as BehaviorSubject<unknown>).next({
      id: shop.id,
      outcome: { action: 'export', result: { commit: null, resources: 3, changed: false, skipped: [] } },
    });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-export-skipped"]')).toBeNull();
  });

  it('shows action results', async () => {
    await setup(projectAdmin, [shop], { params: { id: shop.id } });

    (git['actionResult$'] as BehaviorSubject<unknown>).next({
      id: shop.id,
      outcome: {
        action: 'sync',
        result: { commit: 'abcdef0123456789', state: 'pending', planId: 'p-1', reason: null },
      },
    });
    fixture.detectChanges();

    const result = el().querySelector('[data-testid="git-action-result"]');

    expect(result?.textContent).toContain('abcdef01');
    expect(result?.querySelector('a[href="/activity/plans/p-1"]')).not.toBeNull();

    (git['actionError$'] as BehaviorSubject<unknown>).next({ id: shop.id, action: 'test', error: 'unreachable' });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-action-error"]')?.textContent).toContain('unreachable');
  });

  it('is read-only for viewers', async () => {
    await setup(viewer, [shop]);
    expect(el().querySelector('[data-testid="git-connect"]')).toBeNull();

    TestBed.resetTestingModule();
    await setup(viewer, [shop], { params: { id: shop.id } });

    expect(el().querySelector('[data-testid="git-actions"]')).toBeNull();
    expect(el().querySelector('[data-testid="git-reveal-secret"]')).toBeNull();
    expect(el().querySelector('[data-testid="git-rotate-secret"]')).toBeNull();
    expect(el().querySelector('[data-testid="git-commits"]')).not.toBeNull();
  });

  describe('fleet mode (3.41): project grants as the signed person', () => {
    const fleetSetup = (me: AccessMe, params?: Record<string, string>) =>
      setup(me, [cluster, shop], params ? { params } : {}, undefined, null, true);

    it('lets a project admin manage their project when the cluster verifies the fleet', async () => {
      await fleetSetup({ ...projectAdmin, fleetIdentity: true });
      expect(fixture.componentInstance.freeScopes()).toEqual(['web']);
      expect(el().querySelector('[data-testid="git-fleet-hint"]')).toBeNull();

      TestBed.resetTestingModule();
      await fleetSetup({ ...projectAdmin, fleetIdentity: true }, { id: shop.id });
      expect(el().querySelector('[data-testid="git-actions"]')).not.toBeNull();
    });

    it('hides management and explains it without a verified identity', async () => {
      await fleetSetup({ ...projectAdmin, fleetIdentity: false });
      expect(fixture.componentInstance.freeScopes()).toEqual([]);
      expect(el().querySelector('[data-testid="git-connect"]')).toBeNull();
      expect(el().querySelector('[data-testid="git-fleet-hint"]')?.textContent).toContain(
        "verify this fleet's identity",
      );

      TestBed.resetTestingModule();
      await fleetSetup({ ...projectAdmin, fleetIdentity: false }, { id: shop.id });
      expect(el().querySelector('[data-testid="git-actions"]')).toBeNull();
    });

    it('keeps cluster-wide fleet admins working without a verified identity', async () => {
      await fleetSetup({ userId: null, clusterRole: 'cluster-admin', projects: {} });
      expect(fixture.componentInstance.freeScopes()).toEqual(['web']);
      expect(el().querySelector('[data-testid="git-fleet-hint"]')).toBeNull();
    });
  });

  it('lets cluster admins connect the cluster scope and every project', async () => {
    await setup({ userId: 'a', clusterRole: 'cluster-admin', projects: {} }, [shop]);

    expect(management['loadProjects']).toHaveBeenCalled();
    expect(fixture.componentInstance.freeScopes()).toEqual(['', 'web']);
    expect(el().querySelector('[data-testid="git-connect"]')).not.toBeNull();
  });

  it('shows the SOPS recipient with the encrypt command on its own page', async () => {
    await setup(viewer, [shop], {}, LoadweaverGitSopsPageComponent);

    expect(git['loadSopsRecipient']).toHaveBeenCalled();

    (git['sopsLoaded$'] as BehaviorSubject<unknown>).next(true);
    (git['sopsRecipient$'] as BehaviorSubject<unknown>).next('age1qyqszqgpqyqszqgpqyqszqgpqyqszqgp');
    fixture.detectChanges();

    expect((el().querySelector('[data-testid="git-sops-recipient"] input') as HTMLInputElement).value).toBe(
      'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgp',
    );
    expect((el().querySelector('[data-testid="git-sops-command"] input') as HTMLInputElement).value).toBe(
      'sops --encrypt --age age1qyqszqgpqyqszqgpqyqszqgpqyqszqgp --in-place secrets.yaml',
    );

    (git['sopsUnavailable$'] as BehaviorSubject<unknown>).next(true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="git-sops"]')).toBeNull();
    expect(el().querySelector('[data-testid="git-sops-unavailable"]')).not.toBeNull();
  });

  it('says when a routed connection is missing', async () => {
    await setup(projectAdmin, [shop], { params: { id: 'gone' } });

    expect(el().querySelector('[data-testid="git-not-found"]')).not.toBeNull();
  });
});
