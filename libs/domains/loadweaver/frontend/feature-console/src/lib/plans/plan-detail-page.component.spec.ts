import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleGitFacade,
  ConsolePlansFacade,
  type AccessMe,
  type GitConnection,
  type Plan,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject, of } from 'rxjs';

import { accessStub, facadeStub, gitStub, testGitConnection, testPlan } from '../testing';
import { LoadweaverPlanDetailPageComponent, PR_POLL_MAX_MS, PR_POLL_MS } from './plan-detail-page.component';

describe('LoadweaverPlanDetailPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverPlanDetailPageComponent>;
  let facade: ReturnType<typeof facadeStub>;
  let git: ReturnType<typeof gitStub>;

  async function setup(plan: Plan, me: AccessMe | null, connections: GitConnection[] = []): Promise<void> {
    git = gitStub(connections);
    facade = facadeStub(
      {
        selected$: plan,
        selectedLoading$: false,
        selectedError$: null,
        acting$: null,
        actionError$: null,
        live$: true,
      },
      ['open', 'refresh', 'approve', 'apply', 'cancel', 'discard', 'clearActionError', 'connectLive', 'disconnectLive'],
    );

    await TestBed.configureTestingModule({
      imports: [LoadweaverPlanDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: plan.id })) } },
        { provide: ConsolePlansFacade, useValue: facade },
        { provide: ConsoleGitFacade, useValue: git },
        { provide: ConsoleAccessFacade, useValue: accessStub(me) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoadweaverPlanDetailPageComponent);
    fixture.detectChanges();
    // The tab group activates its tabs after the first render.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const operator: AccessMe = { userId: 'op', clusterRole: null, projects: { shop: 'operator' } };

  it('opens the plan from the route and follows it live', async () => {
    await setup(testPlan(), operator);

    expect(facade['open']).toHaveBeenCalledWith(testPlan().id);
    expect(facade['connectLive']).toHaveBeenCalled();
    fixture.destroy();
    expect(facade['disconnectLive']).toHaveBeenCalled();
  });

  it('shows changes with a before / after diff', async () => {
    await setup(testPlan(), operator);

    expect(el().textContent).toContain('shop/web');
    expect(el().textContent).not.toContain('shop/db');

    fixture.componentInstance.toggle(testPlan().changes[0]);
    fixture.detectChanges();

    const diff = el().querySelector('[data-testid="plan-diff"]')?.textContent ?? '';

    expect(diff).toContain('-   replicas: 1');
    expect(diff).toContain('+   replicas: 2');
  });

  it('lets an operator approve and apply', async () => {
    await setup(testPlan(), operator);

    (el().querySelector('[data-testid="plan-approve"] button') as HTMLButtonElement).click();
    // Asks first.
    expect(facade['approve']).not.toHaveBeenCalled();
    expect(fixture.componentInstance.approveOpen()).toBe(true);

    fixture.componentInstance.confirmApprove();
    expect(facade['approve']).toHaveBeenCalledWith(testPlan().id);
    expect(fixture.componentInstance.approveOpen()).toBe(false);

    fixture.componentInstance.openApply();
    fixture.componentInstance.confirmApply();
    expect(facade['apply']).toHaveBeenCalledWith(testPlan().id, false);
  });

  it('requires the pin acknowledgement before applying pins', async () => {
    await setup(testPlan({ warnings: [{ message: 'unacknowledged digest', pin: true }] }), operator);
    const component = fixture.componentInstance;

    component.openApply();
    component.confirmApply();
    expect(facade['apply']).not.toHaveBeenCalled();

    component.pinsConfirmed.set(true);
    component.confirmApply();
    expect(facade['apply']).toHaveBeenCalledWith(testPlan().id, true);
  });

  it('hides approve for the author and actions for viewers', async () => {
    await setup(testPlan({ createdBy: 'op' }), operator);
    expect(el().querySelector('[data-testid="plan-approve"]')).toBeNull();
    expect(el().querySelector('[data-testid="plan-apply"]')).not.toBeNull();

    TestBed.resetTestingModule();
    await setup(testPlan(), { userId: 'v', clusterRole: null, projects: { shop: 'viewer' } });
    expect(el().querySelector('[data-testid="plan-apply"]')).toBeNull();
  });

  it('shows live progress per node and layer and offers cancel while applying', async () => {
    await setup(
      testPlan({
        status: 'applying',
        progress: {
          phase: 'apply',
          baseRevision: 4,
          targets: { n1: 5 },
          step: 'Applying: waiting for n2',
          percent: 50,
          startedAt: '2026-10-01T10:00:00.000Z',
          nodes: {
            n1: { state: 'applied', steps: [{ layer: 'tunnels', status: 'applied' }] },
            n2: { state: 'pending' },
          },
        },
      }),
      operator,
    );

    const progress = el().querySelector('[data-testid="plan-progress"]')?.textContent ?? '';

    expect(progress).toContain('Applying: waiting for n2');
    expect(progress).toContain('n1');
    expect(progress).toContain('Tunnels (WireGuard): applied');

    fixture.componentInstance.confirmCancel();
    expect(facade['cancel']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="plan-cancel"]')).not.toBeNull();
  });

  it('shows the network effect per layer and the failure analysis', async () => {
    await setup(testPlan(), operator);
    const component = fixture.componentInstance;

    component.activeTab.set('network');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="plan-layer-dns-records"]')?.textContent).toContain('www.example.com');

    component.activeTab.set('workload');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="plan-findings"]')?.textContent).toContain('single copy');
  });

  it('lists added volume copies next to the replica moves (M6 gate)', async () => {
    await setup(
      testPlan({
        workloadChanges: [
          { action: 'move', replica: 'shop/web/web/0', from: 'n1', to: 'n2', method: 'blue-green' },
          { action: 'copy', volume: 'shop/db/data', to: 'n3', copy: 'sync' },
        ],
      }),
      operator,
    );
    fixture.componentInstance.activeTab.set('workload');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const workload = el().querySelector('[data-testid="plan-workload"]')?.textContent ?? '';
    const copy = el().querySelector('[data-testid="plan-volume-copy"]')?.textContent?.replace(/\s+/g, ' ') ?? '';

    expect(workload).toContain('move shop/web/web/0 n1 → n2');
    expect(copy).toContain('shop/db/data: copy added on n3');
  });

  it('shows action errors', async () => {
    await setup(testPlan(), operator);
    (facade['actionError$'] as BehaviorSubject<unknown>).next('The plan cannot be applied yet: shop: approval missing');
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="plan-action-error"]')?.textContent).toContain('approval missing');
  });

  it('shows where a Git plan came from, with commit and pull request links', async () => {
    await setup(
      testPlan({
        source: {
          kind: 'git',
          connection: testGitConnection().id,
          commit: 'abcdef0123456789',
          ref: 'refs/heads/main',
          pr: 12,
          author: 'Dev <dev@example.com>',
        },
      }),
      operator,
      [testGitConnection()],
    );

    const source = el().querySelector('[data-testid="plan-source"]');

    expect(git['load']).toHaveBeenCalledWith(true);
    expect(source?.textContent).toContain('abcdef01');
    expect(source?.textContent).toContain('main');
    expect(source?.textContent).toContain('Dev <dev@example.com>');
    expect(source?.querySelector('a[href="https://github.com/acme/infra/commit/abcdef0123456789"]')).not.toBeNull();
    expect(source?.querySelector('[data-testid="plan-source-pr"]')?.getAttribute('href')).toBe(
      'https://github.com/acme/infra/pull/12',
    );
    // A Git plan is applied here.
    expect(el().querySelector('[data-testid="plan-git-blocked"]')).toBeNull();
  });

  it('explains the authoritative blocker with the opened pull request and disables apply', async () => {
    await setup(
      testPlan({
        source: {
          kind: 'ui',
          author: 'op',
          pullRequests: [
            {
              connection: testGitConnection().id,
              branch: 'loadweaver/plan-x',
              url: 'https://github.com/acme/infra/pull/7',
              number: 7,
            },
          ],
        },
      }),
      operator,
      [testGitConnection({ mode: 'authoritative' })],
    );

    const blocked = el().querySelector('[data-testid="plan-git-blocked"]');

    expect(blocked?.textContent).toContain('Git is authoritative: merge the pull request');
    expect(blocked?.querySelector('[data-testid="plan-git-pr"]')?.getAttribute('href')).toBe(
      'https://github.com/acme/infra/pull/7',
    );
    expect(fixture.componentInstance.gitBlockers()).toHaveLength(1);
    expect((el().querySelector('[data-testid="plan-apply"] button') as HTMLButtonElement | null)?.disabled).toBe(true);
  });

  it('links the recorded pull request, superseded plans, the limit and the authors who may not approve', async () => {
    await setup(
      testPlan({
        source: {
          kind: 'git',
          connection: 'unreadable',
          commit: 'abcdef0123456789',
          pr: 9,
          prUrl: 'https://github.com/acme/infra/pull/9',
          supersedes: 'aaaaaaaa-0000-4000-8000-000000000009',
          limited: 'shop',
          authors: ['dev'],
        },
      }),
      { userId: 'dev', clusterRole: null, projects: { shop: 'operator' } },
    );

    const source = el().querySelector('[data-testid="plan-source"]');
    const pr = source?.querySelector('[data-testid="plan-source-pr"]');

    expect(pr?.getAttribute('href')).toBe('https://github.com/acme/infra/pull/9');
    expect(pr?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(source?.querySelector('[data-testid="plan-source-supersedes"] a')?.getAttribute('href')).toBe(
      '/plans/aaaaaaaa-0000-4000-8000-000000000009',
    );
    expect(source?.querySelector('[data-testid="plan-source-limited"]')?.textContent).toContain('limited to shop');
    expect(source?.querySelector('[data-testid="plan-source-authors"]')?.textContent).toContain('dev');
    // The author of the change can't approve it.
    expect(fixture.componentInstance.canApprove()).toBe(false);
  });

  it('links the plan that superseded a UI plan and ignores non-http pull request URLs', async () => {
    await setup(
      testPlan({
        status: 'discarded',
        source: {
          kind: 'git',
          pr: 4,
          prUrl: 'javascript:alert(1)',
          supersededBy: 'bbbbbbbb-0000-4000-8000-000000000001',
        },
      }),
      operator,
    );

    const source = el().querySelector('[data-testid="plan-source"]');

    expect(source?.querySelector('[data-testid="plan-source-superseded-by"] a')?.getAttribute('href')).toBe(
      '/plans/bbbbbbbb-0000-4000-8000-000000000001',
    );
    expect(source?.querySelector('[data-testid="plan-source-pr"]')).toBeNull();
    expect(source?.textContent).toContain('Pull request #4');
  });

  it('polls while the pull request is being opened and stops when it is there, on timeout or on destroy', async () => {
    const pendingPlan = testPlan({
      source: {
        kind: 'ui',
        pullRequests: [{ connection: testGitConnection().id, branch: 'loadweaver/plan-x', pending: true }],
      },
    });
    const openedPlan = testPlan({
      source: {
        kind: 'ui',
        pullRequests: [
          {
            connection: testGitConnection().id,
            branch: 'loadweaver/plan-x',
            url: 'https://github.com/acme/infra/pull/8',
            number: 8,
          },
        ],
      },
    });

    await setup(testPlan(), operator, [testGitConnection({ mode: 'authoritative' })]);
    jest.useFakeTimers();

    try {
      const selected = facade['selected$'] as BehaviorSubject<unknown>;
      const refresh = facade['refresh'] as jest.Mock;

      selected.next(pendingPlan);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="plan-git-pr-pending"]')?.textContent).toContain(
        'Pull request is being opened',
      );
      // Doesn't claim a link that isn't there yet.
      expect(el().querySelector('[data-testid="plan-git-pr"]')).toBeNull();

      jest.advanceTimersByTime(PR_POLL_MS);
      expect(refresh).toHaveBeenCalledWith(pendingPlan.id);
      jest.advanceTimersByTime(PR_POLL_MS);
      expect(refresh).toHaveBeenCalledTimes(2);

      selected.next(openedPlan);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="plan-git-pr"]')?.getAttribute('href')).toBe(
        'https://github.com/acme/infra/pull/8',
      );
      jest.advanceTimersByTime(PR_POLL_MS * 3);
      expect(refresh).toHaveBeenCalledTimes(2);

      // Gives up after a while and says so.
      refresh.mockClear();
      selected.next({ ...pendingPlan, id: 'another' });
      fixture.detectChanges();
      jest.advanceTimersByTime(PR_POLL_MAX_MS + PR_POLL_MS);

      const calls = refresh.mock.calls.length;

      expect(calls).toBeGreaterThan(30);
      expect(fixture.componentInstance.prPollTimedOut()).toBe(true);
      jest.advanceTimersByTime(PR_POLL_MS * 5);
      expect(refresh).toHaveBeenCalledTimes(calls);
      // A live patch of the same plan doesn't start it again.
      selected.next({ ...pendingPlan, id: 'another', createdAt: '2026-10-02T00:00:00.000Z' });
      fixture.detectChanges();
      jest.advanceTimersByTime(PR_POLL_MS * 5);
      expect(refresh).toHaveBeenCalledTimes(calls);

      // Destroying the page stops polling.
      refresh.mockClear();
      selected.next({ ...pendingPlan, id: 'third' });
      fixture.detectChanges();
      fixture.destroy();
      jest.advanceTimersByTime(PR_POLL_MS * 5);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('warns prominently about resources changed outside Git', async () => {
    await setup(
      testPlan({
        source: { kind: 'git', connection: 'c', commit: 'abcdef1' },
        warnings: [
          {
            level: 'warning',
            path: 'git-conflict',
            kind: 'Deployment',
            name: 'web',
            project: 'shop',
            message: 'Deployment shop/web was changed outside Git since the last sync',
          },
        ],
      }),
      operator,
    );

    expect(el().querySelector('[data-testid="plan-git-conflicts"]')?.textContent).toContain(
      'Deployment shop/web was changed outside Git',
    );
    expect(fixture.componentInstance.otherWarnings()).toEqual([]);
  });
});
