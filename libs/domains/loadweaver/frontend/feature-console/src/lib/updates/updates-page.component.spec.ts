import { NgZone } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import {
  ConsoleAccessFacade,
  ConsoleUpdatesFacade,
  type UpdatesStatus,
} from '@forepath/loadweaver/frontend/data-access-console';
import { BehaviorSubject } from 'rxjs';

import { accessStub, facadeStub, testRelease, testRollout } from '../testing';
import { HOST_ONLY, LoadweaverUpdatesPageComponent } from './updates-page.component';

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

describe('LoadweaverUpdatesPageComponent', () => {
  let fixture: ComponentFixture<LoadweaverUpdatesPageComponent>;
  let facade: ReturnType<typeof facadeStub>;

  async function setup(
    clusterRole: 'cluster-admin' | 'auditor' = 'cluster-admin',
    streams: Record<string, unknown> = {},
    globalAdmin = false,
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
      imports: [LoadweaverUpdatesPageComponent],
      providers: [
        provideRouter([]),
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

    fixture = TestBed.createComponent(LoadweaverUpdatesPageComponent);
    render();
  }

  // The tab group activates its tabs after rendering: a second pass shows the active tab's content.
  const render = () => {
    fixture.detectChanges();
    // Inside the zone, so effects of the rendered views don't start a nested application tick.
    TestBed.inject(NgZone).run(() => TestBed.tick());
    fixture.detectChanges();
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const tab = (id: string) => {
    fixture.componentInstance.selectTab(id);
    render();
  };

  it('shows versions, the policy and nodes with their window state', async () => {
    await setup();

    expect(facade['load']).toHaveBeenCalled();
    expect(el().textContent).toContain('1.1.0');
    expect(el().querySelector('[data-testid="updates-policy"]')?.textContent).toContain(
      'Patches automatically in maintenance windows',
    );
    expect(el().querySelector('[data-testid="updates-policy-edit"]')?.textContent).toContain('Cluster resource');

    const nodes = el().querySelector('[data-testid="updates-nodes"]')?.textContent ?? '';

    expect(nodes).toContain('Reboot required');
    expect(nodes).toContain('→ 1.2.0');
    expect(nodes).toContain('Disconnected');
    expect(el().querySelector('[data-testid="updates-node-window-n1"]')?.textContent).toContain('Next window');
    expect(el().querySelector('[data-testid="updates-node-window-n2"]')?.textContent).toContain(
      'No maintenance window',
    );
    expect(el().querySelector('[data-testid="updates-announcements"]')).toBeNull();
  });

  it('lists releases per channel with download and plan actions for cluster admins', async () => {
    await setup('cluster-admin', {}, true);
    tab('releases');

    expect(el().querySelector('[data-testid="updates-announcements"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="updates-releases-stable"]')?.textContent).toContain('Signed');
    expect(el().querySelector('[data-testid="updates-releases-beta"]')?.textContent).toContain('Unsigned');
    expect(el().querySelector('[data-testid="updates-releases-beta"]')?.textContent).toContain('checksum mismatch');
    (el().querySelector('[data-testid="updates-download-1.3.0-beta.1"] button') as HTMLButtonElement).click();
    expect(facade['download']).toHaveBeenCalledWith('1.3.0-beta.1');
    expect(el().querySelector('[data-testid="updates-plan-1.2.0"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="updates-upload"]')).not.toBeNull();
  });

  it('hides actions from read-only cluster roles', async () => {
    await setup('auditor');
    expect(el().querySelector('[data-testid="updates-policy-edit"]')?.textContent).toContain('Show');
    tab('releases');

    expect(el().querySelector('[data-testid="updates-plan"]')).toBeNull();
    expect(el().querySelector('[data-testid="updates-upload"]')).toBeNull();
    expect(el().querySelector('[data-testid="updates-download-1.3.0-beta.1"]')).toBeNull();
  });

  it('uploads a selected bundle and shows progress', async () => {
    await setup('cluster-admin', { upload$: { fileName: 'b.tar', loaded: 512, total: 1024 } });
    tab('releases');

    const file = new File(['x'], 'b.tar');

    fixture.componentInstance.onBundleSelected({ target: { files: [file] } } as unknown as Event);
    fixture.componentInstance.startUpload();
    render();

    expect(facade['upload']).toHaveBeenCalledWith(file);
    expect(el().querySelector('[data-testid="updates-upload-progress"]')?.textContent).toContain('50 %');
  });

  it('plans an update for a release or host updates only', async () => {
    await setup();

    const page = fixture.componentInstance;

    page.openPlan();
    expect(page.planVersion).toBe('1.2.0');
    page.onPlanHostChange(true);
    page.planOsUpgrade = true;
    page.createPlan();
    expect(facade['create']).toHaveBeenCalledWith({ version: '1.2.0', host: true, osUpgrade: true });

    page.onPlanVersionChange(HOST_ONLY);
    page.planOsUpgrade = false;
    page.createPlan();
    expect(facade['create']).toHaveBeenLastCalledWith({ host: true, osUpgrade: false });
  });

  it('lists update plans and maintenance windows', async () => {
    await setup();
    tab('plans');

    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    expect(el().querySelector('[data-testid="updates-rollouts"]')?.textContent).toContain('1.1.0 → 1.2.0');
    fixture.componentInstance.open(testRollout());
    expect(navigate).toHaveBeenCalledWith(['/updates/rollouts', 'r1']);

    tab('windows');
    expect(el().querySelector('[data-testid="updates-windows"]')?.textContent).toContain('Tue, Thu 02:00–05:00');
    expect(el().querySelector('[data-testid="updates-windows"]')?.textContent).toContain('sites fra1');
    expect(el().querySelector('[data-testid="updates-window-new"]')).not.toBeNull();
    expect(el().textContent).toContain('nodes have no maintenance window');
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
