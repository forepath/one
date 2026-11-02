import { Component, NgZone, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  type UpdatesStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub, testRelease, testRollout } from '../testing';
import { MasterDetailState } from '../section/master-detail.component';
import { LW_SECTION_SCOPE } from '../section/section-scope';
import { LoadweaverUpdatesPageComponent } from './updates-page.component';
import { HOST_ONLY, LoadweaverUpdatesPlanner } from './updates-planner';
import { LoadweaverUpdatesSummaryComponent } from './updates-summary.component';

/** The shell's summary above its list (the master-detail shell renders both). */
@Component({
  selector: 'loadweaver-test-updates',
  standalone: true,
  imports: [LoadweaverUpdatesSummaryComponent, LoadweaverUpdatesPageComponent],
  template: `<loadweaver-updates-summary /><loadweaver-updates-page />`,
})
class UpdatesHostComponent {}

/** Embedded in a node tab: no summary, no planner, no shell. */
@Component({
  selector: 'loadweaver-test-updates-embedded',
  standalone: true,
  imports: [LoadweaverUpdatesPageComponent],
  providers: [{ provide: LW_SECTION_SCOPE, useValue: { params: signal({ q: 'n1' }) } }],
  template: `<loadweaver-updates-page />`,
})
class EmbeddedHostComponent {}

const status: UpdatesStatus = {
  clusterVersion: '1.1.0',
  controlPlaneVersion: '1.1.0',
  policy: {
    policy: 'auto-patch',
    channel: 'beta',
    source: 'github',
    osUpdates: true,
    settleSeconds: 60,
    stepTimeoutMinutes: 30,
  },
  activeRollout: null,
  latestAvailable: '1.2.0',
  nodes: [
    {
      name: 'n1',
      site: 'fra1',
      controlPlane: true,
      connected: true,
      agentVersion: '1.1.0',
      release: '1.1.0',
      target: '1.2.0',
      os: 'debian 12',
      kernel: '6.1.0-25',
      rebootRequired: true,
      overrides: [],
      components: true,
      window: {
        open: false,
        opensAt: '2026-10-20T00:00:00.000Z',
        closesAt: '2026-10-20T03:00:00.000Z',
        windows: ['w'],
      },
    },
    {
      name: 'n2',
      site: 'fra1',
      controlPlane: false,
      connected: false,
      agentVersion: null,
      release: null,
      target: null,
      os: null,
      kernel: null,
      rebootRequired: false,
      overrides: [],
      components: false,
      window: { open: false, opensAt: null, closesAt: null, windows: [] },
    },
  ],
  contractMigrations: { ready: true, blockers: [] },
};

describe('Updates (summary + lanes)', () => {
  let fixture: ComponentFixture<unknown>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(
    clusterRole: 'cluster-admin' | 'auditor' = 'cluster-admin',
    streams: Record<string, unknown> = {},
    globalAdmin = false,
    host: typeof UpdatesHostComponent | typeof EmbeddedHostComponent = UpdatesHostComponent,
  ) {
    const releases = [
      testRelease({
        version: '1.3.0-beta.1',
        channel: 'beta',
        status: 'failed',
        signed: false,
        error: 'checksum mismatch',
      }),
      testRelease(),
      testRelease({ version: '1.1.0', status: 'installed', source: 'installed' }),
    ];

    facade = facadeStub(
      {
        status$: status,
        releasesByChannel$: { stable: releases.slice(1), beta: releases.slice(0, 1) },
        plannableReleases$: [releases[1]],
        rollouts$: [testRollout()],
        windows$: [
          {
            apiVersion: 'loadweaver.io/v1',
            kind: 'MaintenanceWindow',
            metadata: { name: 'nightly' },
            spec: { days: ['tue', 'thu'], start: '02:00', end: '05:00', timeZone: 'Europe/Berlin', sites: ['fra1'] },
          },
        ],
        clusterResource$: 'prod',
        loaded$: true,
        loading$: false,
        error$: null,
        busy$: false,
        downloading$: [],
        downloadError$: null,
        upload$: null,
        uploadError$: null,
        uploaded$: null,
        creating$: false,
        createError$: null,
        ...streams,
      },
      ['load', 'download', 'upload', 'cancelUpload', 'clearUpload', 'create', 'clearCreateError'],
    );

    await TestBed.configureTestingModule({
      imports: [host],
      providers: [
        provideRouter([]),
        ...(host === UpdatesHostComponent ? [LoadweaverUpdatesPlanner, MasterDetailState] : []),
        { provide: ConsoleUpdatesFacade, useValue: facade },
        { provide: ConsoleAccessFacade, useValue: accessStub({ userId: 'u', clusterRole, projects: {} }) },
        {
          provide: AuthenticationFacade,
          useValue: {
            canAccessUserManager$: new BehaviorSubject(globalAdmin),
            authenticationType$: new BehaviorSubject('users'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(host);
    render();
  }

  const render = () => {
    fixture.detectChanges();
    // Inside the zone, so effects of the rendered views don't start a nested application tick.
    TestBed.inject(NgZone).run(() => TestBed.tick());
    fixture.detectChanges();
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const page = () =>
    fixture.debugElement.query(By.directive(LoadweaverUpdatesPageComponent))
      .componentInstance as LoadweaverUpdatesPageComponent;

  it('shows versions and the policy in the summary, nodes with their window state in the windows lane', async () => {
    await setup();

    expect(facade['load']).toHaveBeenCalled();
    expect(el().querySelector('[data-testid="updates-summary"]')?.textContent).toContain('1.1.0');
    expect(el().querySelector('[data-testid="updates-policy"]')?.textContent).toContain(
      'Patches automatically in maintenance windows',
    );
    expect(el().querySelector('[data-testid="updates-policy-edit"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="updates-policy-facts"]')?.textContent).toContain('Beta');

    // Windows | Nodes are tabs of the Windows lane (decision 4).
    page().windowsTab.set('nodes');
    render();

    const nodes = el().querySelector('[data-testid="updates-nodes"]')?.textContent ?? '';

    expect(el().querySelector('[data-testid="updates-nodes"] [aria-label="Reboot required"]')).not.toBeNull();
    expect(nodes).toContain('→ 1.2.0');
    expect(
      [...el().querySelectorAll('[data-testid="updates-nodes"] [data-testid="fpc-data-table-state"]')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    ).toContain('Disconnected');
    expect(el().querySelector('[data-testid="updates-node-window-n1"]')?.textContent).toContain('Next window');
    expect(el().querySelector('[data-testid="updates-node-window-n2"]')?.textContent).toContain(
      'No maintenance window',
    );
    expect(el().querySelector('[data-testid="updates-announcements"]')).toBeNull();
    // One level (3.38): three lanes (lane tabs), the Windows lane's Windows | Nodes tabs inside.
    expect(el().querySelectorAll('fpc-tab-group')).toHaveLength(2);
    expect(el().querySelector('fpc-tab-group')?.classList).toContain('fpc-lane-tabs');
  });

  it('lists releases per channel with download and plan actions for cluster admins', async () => {
    await setup('cluster-admin', {}, true);

    expect(el().querySelector('[data-testid="updates-announcements"]')).not.toBeNull();
    // One releases table grouped by channel (3.38 D1); signed / unsigned as icon-only badges.
    const releases = el().querySelector('[data-testid="updates-releases"]') as HTMLElement;

    expect([...releases.querySelectorAll('[data-testid="fpc-data-table-group"]')].map((g) => g.textContent)).toEqual([
      expect.stringContaining('Stable'),
      expect.stringContaining('Beta'),
    ]);
    expect(releases.querySelector('fpc-badge[aria-label="Signed"], [aria-label="Signed"]')).not.toBeNull();
    expect(releases.querySelector('[aria-label="Unsigned"]')).not.toBeNull();
    expect(releases.textContent).toContain('checksum mismatch');

    const beta = page()
      .releaseRows()
      .find((r) => r.version === '1.3.0-beta.1')!;

    expect(
      page()
        .releaseMenu(beta)
        .map((item) => item.id),
    ).toContain('download');
    page().onReleaseAction(beta, 'download');
    expect(facade['download']).toHaveBeenCalledWith('1.3.0-beta.1');
    expect(el().querySelector('[data-testid="updates-upload"]')).not.toBeNull();

    const searches = [...el().querySelectorAll('[data-testid$="search"] input')].map((input) =>
      input.getAttribute('placeholder'),
    );

    expect(searches).toEqual([]);
    expect(
      [...el().querySelectorAll('fpc-data-table fpc-search-field input')].map((input) =>
        input.getAttribute('placeholder'),
      ),
    ).toEqual(['Search releases', 'Search update plans', 'Search maintenance windows']);

    page().releaseSearch.set('1.2.0');
    render();
    expect(
      page()
        .releaseRows()
        .map((r) => r.version),
    ).toEqual(['1.2.0']);
  });

  it('hides actions from read-only cluster roles', async () => {
    await setup('auditor');

    // Editing the policy (the Cluster resource) is for cluster admins; the card shows it to everyone.
    expect(el().querySelector('[data-testid="updates-policy-edit"]')).toBeNull();
    expect(el().querySelector('[data-testid="updates-plan"]')).toBeNull();
    expect(el().querySelector('[data-testid="updates-upload"]')).toBeNull();
    expect(
      page()
        .releaseMenu(
          page()
            .releaseRows()
            .find((r) => r.version === '1.3.0-beta.1')!,
        )
        .map((i) => i.id),
    ).toEqual(['details']);
  });

  it('uploads a selected bundle from the upload dialog and shows progress', async () => {
    await setup('cluster-admin', { upload$: { fileName: 'b.tar', loaded: 512, total: 1024 } });

    const file = new File(['x'], 'b.tar');

    page().openUpload();
    page().onBundleSelected({ 0: file, length: 1, item: () => file } as unknown as FileList);
    page().startUpload();
    render();
    expect(facade['upload']).toHaveBeenCalledWith(file);
    expect(document.querySelector('[data-testid="updates-upload-progress"]')?.textContent).toContain('50 %');
  });

  it('plans an update for a release or host updates only', async () => {
    await setup();

    const planner = TestBed.inject(LoadweaverUpdatesPlanner);

    page().openPlan();
    expect(planner.open()).toBe(true);
    expect(planner.version).toBe('1.2.0');
    planner.setHost(true);
    planner.osUpgrade = true;
    planner.create();
    expect(facade['create']).toHaveBeenCalledWith({ version: '1.2.0', host: true, osUpgrade: true });

    planner.setVersion(HOST_ONLY);
    planner.osUpgrade = false;
    planner.create();
    expect(facade['create']).toHaveBeenLastCalledWith({ host: true, osUpgrade: false });
  });

  it('lists update plans and maintenance windows', async () => {
    await setup();

    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(el().querySelector('[data-testid="updates-rollouts"]')?.textContent).toContain('1.1.0 → 1.2.0');
    page().open(testRollout());
    expect(navigate).toHaveBeenCalledWith(['/delivery/updates/rollouts', 'r1']);

    expect(el().querySelector('[data-testid="updates-windows"]')?.textContent).toContain('Tue, Thu 02:00–05:00');
    expect(el().querySelector('[data-testid="updates-windows"]')?.textContent).toContain('sites fra1');
    // Table-head "+" of the single-kind windows table → the resource modal (2026-10-29).
    expect(el().querySelector('[data-testid="updates-window-new"]')).toBeNull();
    expect(
      el().querySelector('[data-testid="updates-windows"] [data-testid="create-kind-MaintenanceWindow"]'),
    ).not.toBeNull();
    page().windowsTab.set('nodes');
    render();
    expect(el().textContent).toContain('nodes have no maintenance window');
    page().windowsTab.set('windows');
    render();

    page().windowSearch.set('nothing-like-this');
    page().search.set('nothing-like-this');
    render();
    expect(
      el().querySelector('[data-testid="updates-windows"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
    expect(
      el().querySelector('[data-testid="updates-rollouts"] [data-testid="fpc-data-table-no-matches"]'),
    ).not.toBeNull();
  });

  it('narrows to the Update plans lane while a plan is open', async () => {
    await setup();

    TestBed.inject(MasterDetailState).selectedId.set('r1');
    render();
    expect(el().querySelector('[data-testid="updates-rollouts-lane"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="updates-releases-lane"]')).toBeNull();
    expect(el().querySelector('[data-testid="updates-windows-lane"]')).toBeNull();
  });

  it('embedded in a node tab: plans touching the node and its windows, no releases', async () => {
    await setup('cluster-admin', {}, false, EmbeddedHostComponent);

    expect(page().scopeNode).toBe('n1');
    expect(el().querySelector('[data-testid="updates-releases-lane"]')).toBeNull();
    expect(
      page()
        .nodes()
        .map((n) => n.name),
    ).toEqual(['n1']);
    expect(
      page()
        .scopedWindows()
        ?.map((w) => w.metadata.name),
    ).toEqual([]); // n1 is only in window `w`
    expect(page().scopedRollouts().length).toBe(testRollout().steps.some((step) => step.node === 'n1') ? 1 : 0);
    expect(el().querySelector('loadweaver-saved-views')).toBeNull();
  });

  it('polls faster while a rollout is active', async () => {
    jest.useFakeTimers();

    try {
      await setup('cluster-admin', { busy$: true, rollouts$: [testRollout({ status: 'running' })] });
      (facade['load'] as jest.Mock).mockClear();
      jest.advanceTimersByTime(5_000);
      expect(facade['load']).toHaveBeenCalledWith(true);
      expect(el().querySelector('[data-testid="updates-active"]')?.textContent).toContain('Running');

      (facade['busy$'] as BehaviorSubject<boolean>).next(false);
      (facade['load'] as jest.Mock).mockClear();
      jest.advanceTimersByTime(5_000);
      expect(facade['load']).not.toHaveBeenCalled();
    } finally {
      fixture.destroy();
      jest.useRealTimers();
    }
  });
});
