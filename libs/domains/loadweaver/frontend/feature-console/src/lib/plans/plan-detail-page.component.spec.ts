import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  ConsoleAccessFacade,
  ConsoleEndpointService,
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

  async function setup(
    plan: Plan,
    me: AccessMe | null,
    connections: GitConnection[] = [],
    fleetMode = false,
  ): Promise<void> {
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
        ...(fleetMode ? [{ provide: ConsoleEndpointService, useValue: { fleetMode: true } }] : []),
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

  it('names the author and approvers by email ("Deleted user" when gone), never by raw id (D11)', async () => {
    const author = '6f1c1b0e-0000-4000-8000-000000000001';
    const gone = '6f1c1b0e-0000-4000-8000-0000000000ff';

    await setup(
      testPlan({
        createdBy: author,
        createdByEmail: 'alice@example.com',
        approvals: [{ project: 'shop', userId: gone, userEmail: null, createdAt: '2026-10-18T09:00:00.000Z' }],
      }),
      operator,
    );

    const component = fixture.componentInstance;

    // The header carries no metadata any more (2026-10-29); the Details tab names the author.
    expect(el().querySelector('[data-testid="plan-header"]')).toBeNull();
    component.activeTab.set('details');
    fixture.detectChanges();

    const details = el().querySelector('[data-testid="plan-details"]')?.textContent ?? '';

    expect(details).toContain('Planned by');
    expect(details).toContain('alice@example.com');
    expect(details).not.toContain(author);
    expect(component.approvalColumns.find((c) => c.id === 'user')?.value?.(component.plan()!.approvals[0])).toBe(
      'Deleted user',
    );
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

  it('puts back left of the title, status and Live once in the header context, discard in More, apply last (LW-06)', async () => {
    await setup(testPlan(), operator);

    expect(el().querySelector('fpc-page-header [data-testid="plan-back"].fpc-md__back')).not.toBeNull();
    // The status is the row under the header (always, 2026-10-29), not a header badge.
    expect(el().querySelector('fpc-page-header [data-testid="plan-status"]')).toBeNull();
    expect(el().querySelector('[data-testid="plan-progress"] [data-testid="plan-status"]')).not.toBeNull();
    expect(el().querySelectorAll('[data-testid="plan-live"]')).toHaveLength(1);
    expect(el().querySelector('fpc-status-badge')).toBeNull();

    const actions = [...el().querySelectorAll('fpc-page-header [data-testid^="plan-"]')]
      .map((a) => a.getAttribute('data-testid'))
      .filter((id) => id === 'plan-approve' || id === 'plan-apply' || id === 'plan-more');

    // Primary rightmost; the destructive discard is a danger item of the More menu, no red inline button.
    expect(actions[actions.length - 1]).toBe('plan-apply');
    expect(actions).toContain('plan-more');
    expect(el().querySelector('fpc-page-header .btn-danger')).toBeNull();
    (el().querySelector('[data-testid="plan-more"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const discard = document.querySelector('[data-testid="plan-discard"] a') as HTMLAnchorElement;

    expect(discard.className).toContain('danger');
    discard.click();
    expect(fixture.componentInstance.discardOpen()).toBe(true);
    // Changes, Network, Workload, Warnings, Approvals and Details (the metadata, 2026-10-29) — no more.
    expect(el().querySelectorAll('fpc-tab-group:not(.fpc-lane-tabs) fpc-tab').length).toBeLessThanOrEqual(6);
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

  it('fleet mode (3.24): approve through the fleet when the cluster trusts it, else the native hint', async () => {
    await setup(testPlan(), { ...operator, userId: 'fleet:f1:op2', fleetApprovals: true }, [], true);
    expect(el().querySelector('[data-testid="plan-approve"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="plan-fleet-approval"]')).toBeNull();
    fixture.destroy();

    TestBed.resetTestingModule();
    await setup(testPlan(), { ...operator, userId: null, fleetApprovals: false }, [], true);
    expect(el().querySelector('[data-testid="plan-approve"]')).toBeNull();
    expect(el().querySelector('[data-testid="plan-fleet-approval"]')?.textContent).toContain('Establish trust');
    fixture.destroy();
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

    const row = el().querySelector('[data-testid="plan-progress"]') as HTMLElement;
    const bar = row.querySelector('[role="progressbar"]') as HTMLElement;

    // A full-width row under the header (2026-10-29): no lane, no subheadline, just the slim bar and the status.
    expect(row.closest('fpc-section-row')).toBeNull();
    expect(row.querySelector('fpc-lane-header, h2, h3')).toBeNull();
    expect(row.textContent).not.toContain('Apply progress');
    expect(row.textContent).toContain('Applying: waiting for n2');
    expect(row.textContent).toContain('50%');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('aria-label')).toBe('Apply progress');
    expect(row.querySelector('.progress-bar')?.classList).toContain('progress-bar-animated');
    expect(fixture.componentInstance.laneTabs().map((t) => t.id)).toEqual(['main']);

    // The per-node table is a disclosure under the row.
    expect(row.querySelector('[data-testid="plan-progress-nodes"]')).toBeNull();
    (row.querySelector('[data-testid="plan-progress-nodes-toggle"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const nodes = row.querySelector('[data-testid="plan-progress-nodes"]')?.textContent ?? '';

    expect(nodes).toContain('n1');
    expect(nodes).toContain('Tunnels (WireGuard): applied');
    expect(row.querySelector('table.table-striped')).toBeNull();

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
    // One table grouped by layer (3.38 D1).
    expect(el().querySelector('[data-testid="plan-network"]')?.textContent).toContain('www.example.com');
    expect(el().querySelector('[data-testid="plan-network"] [data-testid="fpc-data-table-group"]')).not.toBeNull();
    // Network effect and compiler diagnostics side by side (two lanes of the row; phone lane tabs pick one).
    const lanes = el().querySelector('[data-testid="plan-lanes"]') as HTMLElement;

    expect(lanes.querySelectorAll('loadweaver-lane').length).toBe(2);
    expect(lanes.querySelector('[data-testid="plan-diagnostics-lane"]')?.textContent).toContain(
      'No compiler diagnostics',
    );
    expect(component.laneTabs().map((t) => t.id)).toEqual(['main', 'diagnostics']);
    // No apply running: the status row still shows the plan's status, without a percentage (2026-10-29).
    expect(el().querySelector('[data-testid="plan-progress"]')?.textContent).toContain('Pending');
    expect(el().querySelector('[data-testid="plan-progress"]')?.textContent).not.toContain('%');

    component.activeTab.set('workload');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="plan-findings"]')?.textContent).toContain('single copy');
  });

  it('lists compiler diagnostics in their own lane beside the network effect', async () => {
    await setup(
      testPlan({ diagnostics: [{ level: 'warning', path: 'shop/web', message: 'port 80 shadowed' }] }),
      operator,
    );
    fixture.componentInstance.activeTab.set('network');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const lane = el().querySelector('[data-testid="plan-diagnostics-lane"]') as HTMLElement;

    expect(lane.querySelector('[data-testid="plan-diagnostics"]')?.textContent).toContain('port 80 shadowed');
    expect(lane.querySelector('fpc-badge')?.textContent?.trim()).toBe('1');
  });

  it('tones a failed rollback row danger without animation', async () => {
    await setup(
      testPlan({
        status: 'rollback-failed',
        progress: {
          phase: 'rollback',
          baseRevision: 4,
          targets: null,
          step: 'Rollback stopped',
          percent: 80,
          startedAt: '2026-10-01T10:00:00.000Z',
          nodes: {},
          failure: 'n2 unreachable',
          cause: 'layer dns failed',
        },
      }),
      operator,
    );

    const row = el().querySelector('[data-testid="plan-progress"]') as HTMLElement;
    const fill = row.querySelector('.progress-bar') as HTMLElement;

    expect(fill.classList).toContain('bg-danger');
    expect(fill.classList).not.toContain('progress-bar-animated');
    expect(row.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('Rollback progress');
    expect(row.textContent).toContain('n2 unreachable');
    expect(row.textContent).toContain('layer dns failed');
    expect(row.querySelector('[data-testid="plan-progress-nodes-toggle"]')).toBeNull();
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

    const workload = el().querySelector('[data-testid="plan-workload"]')?.textContent?.replace(/\s+/g, ' ') ?? '';
    const actions = [
      ...el().querySelectorAll('[data-testid="plan-workload"] [data-testid="fpc-data-table-state"]'),
    ].map((b) => b.getAttribute('aria-label'));

    // A table (3.38 D1): State (readable action) · replica or volume · where · method.
    expect(actions).toEqual(['Move', 'volume copy']);
    expect(workload).toContain('shop/web/web/0');
    expect(workload).toContain('n1 → n2');
    expect(workload).toContain('shop/db/data');
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

    // The source sits on the Details tab (2026-10-29).
    fixture.componentInstance.activeTab.set('details');
    fixture.detectChanges();

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

    // One pending-notes alert (LW-08 round 2): the Git heading on it, the blocker list inside.
    expect(el().querySelector('[data-testid="plan-pending-notes"]')?.textContent).toContain(
      'Git is authoritative: merge the pull request',
    );
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

    // The source sits on the Details tab (2026-10-29).
    fixture.componentInstance.activeTab.set('details');
    fixture.detectChanges();

    const source = el().querySelector('[data-testid="plan-source"]');
    const pr = source?.querySelector('[data-testid="plan-source-pr"]');

    expect(pr?.getAttribute('href')).toBe('https://github.com/acme/infra/pull/9');
    expect(pr?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(source?.querySelector('[data-testid="plan-source-supersedes"] a')?.getAttribute('href')).toBe(
      '/activity/plans/aaaaaaaa-0000-4000-8000-000000000009',
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

    // The source sits on the Details tab (2026-10-29).
    fixture.componentInstance.activeTab.set('details');
    fixture.detectChanges();

    const source = el().querySelector('[data-testid="plan-source"]');

    expect(source?.querySelector('[data-testid="plan-source-superseded-by"] a')?.getAttribute('href')).toBe(
      '/activity/plans/bbbbbbbb-0000-4000-8000-000000000001',
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
