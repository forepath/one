import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  AuthenticationFacade,
  IDENTITY_AUTH_ENVIRONMENT,
  IdentityLogoutConfirmModalComponent,
} from '@forepath/identity/frontend';
import {
  type AccessMe,
  ConsoleAccessFacade,
  ConsoleFleetFacade,
  type FleetAvailability,
  FleetClusterAvailabilityService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { ENVIRONMENT, LocaleService } from '@forepath/loadweaver/frontend/util-configuration';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
import { of, type BehaviorSubject } from 'rxjs';
import { Component, signal } from '@angular/core';

import {
  CONSOLE_NAV_ITEMS,
  CONSOLE_SECTIONS,
  activeConsoleNavPath,
  sectionForUrl,
  visibleConsoleRail,
} from '../console-nav';
import { ConsoleNavService } from '../nav/console-nav.service';
import { ConsoleSettingsService } from '../nav/console-settings.service';
import { consoleShortcut, isTypingTarget } from '../nav/shortcuts';
import { LoadweaverSearchPaletteComponent } from '../search/search-palette.component';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverConsoleContainerComponent } from './container.component';
import { ConsoleTaskFeedService } from '../nav/task-feed.service';
import { LoadweaverResourceModalComponent } from '../objects/resource-modal.component';
import { ResourceModalService } from '../objects/resource-modal.service';

@Component({ standalone: true, template: '' })
class BlankComponent {}

const CLUSTER_A = '6f1c1b0e-0000-4000-8000-00000000000a';
const clusterAdmin: AccessMe = { userId: 'u1', clusterRole: 'cluster-admin', projects: {} };
const developer: AccessMe = { userId: 'u2', clusterRole: null, projects: { shop: 'developer' } };

const context = {
  infrastructure: false,
  me: null,
  clusterAdmin: false,
  userManager: false,
  globalAdmin: false,
  patUi: false,
};

describe('console navigation', () => {
  it('has the function rail in order, every page once', () => {
    expect(CONSOLE_SECTIONS.map((section) => section.id)).toEqual([
      'setup',
      'resources',
      'activity',
      'observe',
      'operate',
      'delivery',
      'access',
    ]);
    expect(new Set(CONSOLE_NAV_ITEMS.map((item) => item.path)).size).toBe(CONSOLE_NAV_ITEMS.length);
  });

  it('drops only sections without a visible page; a tile opens the first visible page', () => {
    const tiles = visibleConsoleRail(CONSOLE_SECTIONS, context);

    // No role: Access keeps Devices; Delivery keeps DNS (the rest is infrastructure).
    expect(tiles.map((tile) => tile.section)).toEqual([
      'resources',
      'activity',
      'observe',
      'operate',
      'delivery',
      'access',
    ]);
    expect(tiles.find((tile) => tile.section === 'delivery')?.path).toBe('/delivery/dns');
    expect(tiles.find((tile) => tile.section === 'access')?.path).toBe('/access/devices');

    const admin = visibleConsoleRail(CONSOLE_SECTIONS, { ...context, infrastructure: true, me: clusterAdmin });

    expect(admin.find((tile) => tile.section === 'delivery')?.path).toBe('/delivery/git');
    expect(admin.find((tile) => tile.section === 'access')?.path).toBe('/access/members');
    expect(admin.find((tile) => tile.section === 'operate')?.items.map((item) => item.path)).toContain(
      '/operate/backups/keys',
    );
  });

  it('matches the longest prefix and maps URLs to sections', () => {
    const items = [...CONSOLE_NAV_ITEMS, { path: '/updates/announcements', icon: '', label: '', title: '' }];

    expect(activeConsoleNavPath('/delivery/updates?tab=plans', items)).toBe('/delivery/updates');
    expect(activeConsoleNavPath('/delivery/updates/rollouts/r1', items)).toBe('/delivery/updates');
    expect(activeConsoleNavPath('/updates/announcements', items)).toBe('/updates/announcements');
    // DNS (3.38): four sub-nav entries, `/delivery/dns` stays the records.
    expect(activeConsoleNavPath('/delivery/dns', items)).toBe('/delivery/dns');
    expect(activeConsoleNavPath('/delivery/dns/zones', items)).toBe('/delivery/dns/zones');
    expect(activeConsoleNavPath('/delivery/git/c1', items)).toBe('/delivery/git');
    expect(activeConsoleNavPath('/access/requests/shop', items)).toBe('/access/members');
    expect(activeConsoleNavPath('/de/operate/backups/restores', items)).toBe('/operate/backups/restores');
    expect(activeConsoleNavPath('/operate/backups/0b1c', items)).toBe('/operate/backups');
    expect(activeConsoleNavPath('/search', items)).toBeNull();
    expect(sectionForUrl('/observe/alerts/a1', CONSOLE_SECTIONS)).toBe('observe');
    expect(sectionForUrl('/account/tokens', CONSOLE_SECTIONS)).toBeNull();
  });

  it('recognises the global shortcuts, never while typing', () => {
    expect(consoleShortcut(null, '/')).toEqual({ kind: 'search' });
    expect(consoleShortcut(null, 'g')).toEqual({ kind: 'prefix', prefix: 'g' });
    expect(consoleShortcut('g', 'a')).toEqual({ kind: 'section', section: 'activity' });
    expect(consoleShortcut('g', 'x')).toBeNull();
    expect(consoleShortcut(null, 'x')).toBeNull();

    const input = document.createElement('input');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('LoadweaverConsoleContainerComponent', () => {
  let fixture: ComponentFixture<LoadweaverConsoleContainerComponent>;
  let auth: ReturnType<typeof facadeStub>;
  let updates: ReturnType<typeof facadeStub>;
  let fleet: ReturnType<typeof facadeStub> & { fleetMode: boolean; activeClusterId: ReturnType<typeof signal> };
  let accessFacade: ReturnType<typeof accessStub>;
  let availability: {
    availability: ReturnType<typeof signal<FleetAvailability | null>>;
    paused: ReturnType<typeof signal<FleetAvailability | null>>;
    refresh: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
  };

  async function setup(
    me: AccessMe | null,
    {
      userManager = false,
      type = 'users',
      attention = false,
      fleetMode = false,
      activeCluster = null,
    }: {
      userManager?: boolean;
      type?: string;
      attention?: boolean;
      fleetMode?: boolean;
      activeCluster?: string | null;
    } = {},
    url = '/overview',
  ): Promise<HTMLElement> {
    auth = facadeStub(
      {
        isAuthenticated$: true,
        twoFactorStatus$: { totpEnabled: true },
        canAccessUserManager$: userManager,
        authenticationType$: type,
      },
      ['checkAuthentication', 'loadTwoFactorStatus', 'logout'],
    );
    updates = facadeStub({ hasAttention$: attention }, ['loadStatus']);
    fleet = Object.assign(
      facadeStub({ clusters$: [{ id: CLUSTER_A, name: 'alpha', health: { state: 'healthy' } }] }, [
        'openCluster',
        'leaveCluster',
        'loadClusters',
      ]),
      {
        fleetMode,
        activeClusterId: signal<string | null>(activeCluster),
      },
    );

    const access = accessStub(me);

    access['clear'] = jest.fn();
    accessFacade = access;
    availability = {
      availability: signal(null),
      paused: signal(null),
      refresh: jest.fn(() => of(null)),
      start: jest.fn(),
      stop: jest.fn(),
    };

    TestBed.configureTestingModule({
      imports: [LoadweaverConsoleContainerComponent],
      providers: [
        {
          provide: ConsoleTaskFeedService,
          useValue: {
            start: jest.fn(),
            stop: jest.fn(),
            running: signal(0),
            open: signal(false),
            controlling: signal(null),
            controlError: signal(null),
            control: jest.fn(),
            tasks: signal([]),
            events: signal([]),
            loading: signal(false),
            refreshNow: jest.fn(),
          },
        },
        provideRouter([{ path: '**', component: BlankComponent }]),
        { provide: AuthenticationFacade, useValue: auth },
        { provide: ConsoleAccessFacade, useValue: access },
        { provide: AdminUpdatesFacade, useValue: updates },
        { provide: ConsoleFleetFacade, useValue: fleet },
        { provide: FleetClusterAvailabilityService, useValue: availability },
        ConsoleNavService,
        {
          provide: ConsoleSettingsService,
          useValue: { load: jest.fn() },
        },
        { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: { authentication: { type } } },
        { provide: ENVIRONMENT, useValue: { application: { productName: 'Loadweaver' } } },
        {
          provide: LocaleService,
          useValue: { getAvailableLocales: () => [], getCurrentLocale: () => 'en', getLanguageSwitchUrl: () => '' },
        },
      ],
    });
    TestBed.overrideComponent(LoadweaverConsoleContainerComponent, {
      remove: {
        imports: [
          IdentityLogoutConfirmModalComponent,
          LoadweaverSearchPaletteComponent,
          LoadweaverResourceModalComponent,
        ],
      },
      add: { schemas: [NO_ERRORS_SCHEMA] },
    });
    await TestBed.compileComponents();

    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(LoadweaverConsoleContainerComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  function group(element: HTMLElement, id: string): HTMLElement | null {
    return element.querySelector(`[data-testid="console-nav-group-${id}"]`);
  }

  function inGroup(element: HTMLElement, id: string, selector: string): HTMLElement | null {
    const host = group(element, id);

    if (!host) throw new Error(`group ${id} not rendered`);

    return host.querySelector(selector);
  }

  /** The fleet's own items rendered as plain sidebar links (outside any popover). */
  function fleetLinks(element: HTMLElement): (string | null)[] {
    return Array.from(element.querySelectorAll('fpc-sidebar a.sidebar__item'))
      .filter((a) => !a.closest('fpc-sidebar-popover'))
      .map((a) => a.getAttribute('href'))
      .filter((href) => href?.startsWith('/fleet'));
  }

  function trigger(element: HTMLElement, id: string): HTMLElement {
    return inGroup(element, id, '[fpcSidebarPopoverTrigger]') as HTMLElement;
  }

  /** The rail tiles' links (outside the footer popovers). */
  function railLinks(element: HTMLElement): (string | null)[] {
    return Array.from(element.querySelectorAll('fpc-sidebar a.sidebar__item'))
      .filter((a) => !a.closest('fpc-sidebar-popover'))
      .map((a) => a.getAttribute('href'));
  }

  it('renders the function rail as one-click tiles for a cluster admin', async () => {
    const element = await setup(clusterAdmin);

    expect(railLinks(element)).toEqual([
      '/setup',
      '/resources/cluster',
      '/activity/plans',
      '/observe/health',
      '/operate/terminals',
      '/delivery/git',
      '/access/members',
    ]);
    expect(
      element.querySelector('fpc-sidebar fpc-sidebar-popover [data-testid="console-nav-section-observe"]'),
    ).toBeNull();
    // Footer: Account and Admin popovers.
    expect(trigger(element, 'account').getAttribute('role')).toBe('button');
    expect(trigger(element, 'admin').getAttribute('tabindex')).toBe('0');
  });

  it('offers Create and the search field in the top bar', async () => {
    const element = await setup(clusterAdmin);
    const modal = TestBed.inject(ResourceModalService);

    expect(element.querySelector('[data-testid="console-search"]')?.textContent).toContain('Search');
    // Create ▾ opens the create modal over the current page (2026-10-29), no navigation.
    fixture.componentInstance.openCreate('VirtualMachine');
    expect(modal.request()).toEqual({ mode: 'create', kind: 'VirtualMachine', project: null });
    expect(element.querySelector('loadweaver-resource-modal')).not.toBeNull();
  });

  it('gates Create ▾ by role: developers yes, viewers / auditors without project rights no', async () => {
    expect((await setup(developer)).querySelector('[data-testid="console-create"]')).not.toBeNull();
    TestBed.resetTestingModule();
    expect(
      (await setup({ userId: 'u3', clusterRole: 'auditor', projects: { shop: 'viewer' } })).querySelector(
        '[data-testid="console-create"]',
      ),
    ).toBeNull();
  });

  it('lays the top bar out per 3.38 R13: primary Create, top-bar actions only, prefs in the one row', async () => {
    const element = await setup(clusterAdmin);
    const create = element.querySelector('[data-testid="console-create"] .fpc-button__btn') as HTMLElement;

    // Create is the primary "+" (not a faint link); the search trigger uses the shared top-bar style.
    expect(create.classList).toContain('btn-primary');
    expect(element.querySelector('[data-testid="console-search"]')?.classList).toContain('fpc-top-bar__search');
    // The draft chip is a top-bar action button, never an underlined link.
    const chip = element.querySelector('[data-testid="console-draft-chip"]') as HTMLElement;
    expect(chip.classList).toContain('fpc-top-bar__action');
    // Language / theme sit in the single top bar on every width (like Agenstra / Decabill); no density toggle.
    const topBars = element.querySelectorAll('fpc-top-bar');
    expect(topBars).toHaveLength(1);
    expect(element.querySelector('[data-testid="console-density"]')).toBeNull();
    expect(topBars[0].querySelector('fpc-language-switcher')).not.toBeNull();
    expect(topBars[0].querySelector('fpc-theme-switcher')).not.toBeNull();
    // Logout: primary, sm on phones and md from md on.
    const logout = [...element.querySelectorAll('fpc-top-bar .fpc-button__btn')].find((b) =>
      b.textContent?.includes('Logout'),
    ) as HTMLElement;
    expect(logout.classList).toContain('btn-primary');
    expect(logout.classList).toContain('fpc-button__btn--md-md');
    // No raw Bootstrap buttons / spinners in the top bar.
    expect(element.querySelector('fpc-top-bar > .fpc-top-bar__actions > button.btn')).toBeNull();
    expect(element.querySelector('fpc-top-bar .spinner-border:not(fpc-spinner *)')).toBeNull();
  });

  describe('phone navigation = the shared Agenstra / Decabill concept (2026-10-29)', () => {
    it('renders the shared fpc-sidebar rail with footer popovers, and no custom bottom bar / More sheet / phone row', async () => {
      const element = await setup(clusterAdmin);
      const sidebar = element.querySelector('fpc-sidebar') as HTMLElement;

      expect(sidebar.getAttribute('role')).toBe('navigation');
      expect(sidebar.getAttribute('aria-label')).toBe('Main navigation');
      expect(sidebar.querySelectorAll('fpc-sidebar-popover')).toHaveLength(2);
      expect(sidebar.querySelector('[fpcSidebarFooter] [data-testid="console-nav-group-admin"]')).not.toBeNull();
      expect(element.querySelector('[data-testid="console-bottom-bar"]')).toBeNull();
      expect(element.querySelector('.lw-bottom-bar')).toBeNull();
      expect(element.querySelector('[data-testid="console-more-sheet"]')).toBeNull();
      expect(element.querySelector('[data-testid="console-top-bar-phone"]')).toBeNull();
    });

    it('closes the footer popover when one of its items navigates', async () => {
      const element = await setup(clusterAdmin, { userManager: true });

      trigger(element, 'admin').click();
      fixture.detectChanges();
      expect(fixture.componentInstance.openPopover()).toBe('admin');

      (inGroup(element, 'admin', 'a[href="/webhooks"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.openPopover()).toBeNull();
      expect(inGroup(element, 'admin', 'a[href="/webhooks"]')).toBeNull();
    });

    it('keeps Create, the draft chip and the running-tasks badge (opens the task dock) reachable in the top bar', async () => {
      const element = await setup(clusterAdmin);
      const tasks = TestBed.inject(ConsoleTaskFeedService) as unknown as {
        running: ReturnType<typeof signal<number>>;
        open: ReturnType<typeof signal<boolean>>;
      };

      expect(element.querySelector('fpc-top-bar [data-testid="console-create"]')).not.toBeNull();
      expect(element.querySelector('fpc-top-bar [data-testid="console-draft-chip"]')).not.toBeNull();
      expect(element.querySelector('[data-testid="console-running-badge"]')).toBeNull();

      tasks.running.set(2);
      fixture.detectChanges();
      const running = element.querySelector('fpc-top-bar [data-testid="console-running-badge"]') as HTMLElement;

      expect(running.textContent).toContain('2');
      (running.querySelector('button') as HTMLElement).click();
      expect(tasks.open()).toBe(true);
      expect(element.querySelector('loadweaver-task-dock')).not.toBeNull();
    });

    it('fleet root: the fleet pages on the rail, no Create / draft (nothing to create at the fleet level)', async () => {
      const element = await setup(null, { fleetMode: true, userManager: true }, '/fleet');

      expect(fleetLinks(element)).toContain('/fleet');
      expect(element.querySelector('[data-testid="console-create"]')).toBeNull();
      expect(element.querySelector('[data-testid="console-draft-chip"]')).toBeNull();
    });
  });

  it('opens sections with "g" shortcuts and the search with "/"', async () => {
    await setup(clusterAdmin);
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const palette = { show: jest.fn() };

    fixture.componentInstance.onShortcutKey(new KeyboardEvent('keydown', { key: 'g' }), palette);
    fixture.componentInstance.onShortcutKey(new KeyboardEvent('keydown', { key: 'o' }), palette);
    expect(navigate).toHaveBeenCalledWith('/observe/health');

    fixture.componentInstance.onShortcutKey(new KeyboardEvent('keydown', { key: '/' }), palette);
    expect(palette.show).toHaveBeenCalled();
  });

  it('warns cluster admins when email 2FA is not enforced because SMTP is not configured', async () => {
    const element = await setup({ ...clusterAdmin, emailLogin2faSuspended: true });
    const banner = element.querySelector('[data-testid="console-email-not-configured"]');

    expect(banner?.textContent).toContain('Email is not configured — two-factor login is not enforced.');
    // SMTP comes from the control-plane environment only: the link leads to the docs on configuring it.
    expect(banner?.querySelector('a')?.getAttribute('href')).toBe(
      'https://docs.loadweaver.com/loadweaver/console#email-and-two-factor-login',
    );
    expect(banner?.querySelector('a')?.textContent?.trim()).toBe('How to configure SMTP');
  });

  it('shows no email banner when SMTP is configured or the caller is not a cluster admin', async () => {
    let element = await setup({ ...clusterAdmin, emailLogin2faSuspended: false });

    expect(element.querySelector('[data-testid="console-email-not-configured"]')).toBeNull();

    TestBed.resetTestingModule();
    element = await setup({ ...developer, emailLogin2faSuspended: true });
    expect(element.querySelector('[data-testid="console-email-not-configured"]')).toBeNull();
  });

  it('keeps the rail for project members, with infrastructure pages hidden inside the sections', async () => {
    const element = await setup(developer, { type: 'api-key' });

    const delivery = fixture.componentInstance.rail().find((tile) => tile.section === 'delivery');

    expect(railLinks(element)).toContain('/delivery/git');
    expect(delivery?.items.map((item) => item.path)).toEqual(['/delivery/git', '/delivery/sops', '/delivery/dns']);
    // api-key: no PAT UI, so Account only has Git accounts.
    expect(fixture.componentInstance.accountNavItems().map((item) => item.path)).toEqual(['/account/git-accounts']);
  });

  it('marks the tile of the current route active and opens one footer popover at a time', async () => {
    const element = await setup(clusterAdmin, {}, '/delivery/updates/rollouts/r1');

    expect(element.querySelector('a.sidebar__item.active')?.getAttribute('href')).toBe('/delivery/git');

    trigger(element, 'account').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.openPopover()).toBe('account');

    trigger(element, 'admin').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.openPopover()).toBe('admin');
  });

  it('shows the admin Updates item (with the attention badge) only to global admins', async () => {
    let element = await setup(clusterAdmin, { userManager: false });

    expect(fixture.componentInstance.adminNavItems().map((item) => item.path)).toEqual([
      '/webhooks',
      '/settings/trusted-fleets',
    ]);
    expect(updates['loadStatus']).not.toHaveBeenCalled();
    expect(inGroup(element, 'admin', 'fpc-notification-indicator')).toBeNull();

    TestBed.resetTestingModule();
    element = await setup(clusterAdmin, { userManager: true, attention: true }, '/updates/announcements');

    expect(fixture.componentInstance.adminNavItems().map((item) => item.path)).toEqual([
      '/webhooks',
      '/settings/trusted-fleets',
      '/users',
      '/updates/announcements',
    ]);
    expect(updates['loadStatus']).toHaveBeenCalled();
    expect(trigger(element, 'admin').classList).toContain('active');
    expect(trigger(element, 'admin').querySelector('fpc-notification-indicator')).not.toBeNull();
  });

  it('fleet mode without a cluster: only the fleet items, flat, and no top-bar cluster switcher', async () => {
    const element = await setup(null, { fleetMode: true, userManager: true }, '/fleet/compare');

    // Compare needs at least 2 visible clusters (2026-10-28): hidden with the stub's single cluster.
    expect(fixture.componentInstance.rail().map((tile) => tile.key)).not.toContain('/fleet/compare');
    (fleet['clusters$'] as BehaviorSubject<unknown>).next([
      { id: CLUSTER_A, name: 'alpha', health: { state: 'healthy' } },
      { id: 'b2c4e6a8-0000-4000-8000-000000000002', name: 'beta', health: { state: 'healthy' } },
    ]);
    fixture.detectChanges();

    // No Fleet popover: the fleet routes are plain sidebar tiles (Audit: the user manager is a global admin).
    const fleetPaths = ['/fleet', '/fleet/clusters', '/fleet/compare', '/fleet/operations', '/fleet/audit'];

    expect(group(element, 'fleet')).toBeNull();
    expect(fixture.componentInstance.rail().map((tile) => tile.key)).toEqual(fleetPaths);
    expect(fleetLinks(element)).toEqual(fleetPaths);
    expect(element.querySelector('a[href="/fleet"] span.small')?.textContent?.trim()).toBe('Overview');
    // Same icon as the cluster's Overview item.
    expect(element.querySelector('a[href="/fleet"] i.bi-grid')).not.toBeNull();
    expect(element.querySelector('a[href="/fleet/audit"] span.small')?.textContent?.trim()).toBe('Audit');
    expect(element.querySelector('a.sidebar__item.active')?.getAttribute('href')).toBe('/fleet/compare');
    expect(element.querySelector('a.sidebar__item.active i.bi-layout-split')).not.toBeNull();
    // The cluster's own admin features aren't reached through the fleet; the fleet's users are.
    expect(fixture.componentInstance.adminNavItems().map((item) => item.path)).toEqual(['/users']);
    // Linked Git accounts belong to a cluster: offered once one is open (3.41).
    expect(fixture.componentInstance.accountNavItems().map((item) => item.path)).not.toContain('/account/git-accounts');
    // Clusters are opened from the fleet pages; the top bar has no cluster switcher.
    expect(element.querySelector('[data-testid="console-cluster-switcher"]')).toBeNull();
    expect(element.querySelector('fpc-top-bar select')).toBeNull();
  });

  it('fleet mode with a cluster: the cluster sidebar minus what the relay never carries', async () => {
    const element = await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });
    const paths = fixture.componentInstance.rail().flatMap((tile) => tile.items.map((item) => item.path));

    // "Back" replaces the fleet items while a cluster is open.
    expect(group(element, 'fleet')).toBeNull();
    expect(paths.some((path) => path.startsWith('/fleet'))).toBe(false);
    expect(paths).toContain('/activity/plans');
    expect(paths).toContain('/operate/files');
    // The cluster view has the cluster's features (2026-10-27), Git connections included.
    expect(paths).toContain('/delivery/git');
    expect(paths).not.toContain('/access/devices');
    // Linked Git accounts are the signed person's on the open cluster (3.41).
    expect(fixture.componentInstance.accountNavItems().map((item) => item.path)).toContain('/account/git-accounts');
    expect(element.querySelector('[data-testid="console-nav-section-delivery"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="console-cluster-switcher"]')).toBeNull();
  });

  it('fleet mode: loads the fleet clusters on sign-in so the cluster chip has a name on every page', async () => {
    await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });

    expect(fleet['loadClusters']).toHaveBeenCalled();
  });

  describe('unreachable / read-only cluster (3.43, 2026-10-31)', () => {
    const readOnly: FleetAvailability = {
      state: 'read-only',
      reason: 'members down',
      freeze: null,
      takenOverAt: null,
      checkedAt: '2026-10-31T10:00:00Z',
    };

    function banner(element: HTMLElement): HTMLElement | null {
      return element.querySelector('[data-testid="console-cluster-paused"]');
    }

    it('shows a banner on the open cluster’s pages while changes are paused', async () => {
      const element = await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });

      expect(banner(element)).toBeNull();

      availability.availability.set(readOnly);
      availability.paused.set(readOnly);
      fixture.detectChanges();
      expect(banner(element)?.getAttribute('data-state')).toBe('read-only');
      expect(fixture.componentInstance.pausedMessage(readOnly)).toContain('read-only');
      expect(fixture.componentInstance.pausedMessage(readOnly)).toContain('Members down');

      const unreachable = { ...readOnly, state: 'unreachable' as const, reason: 'ECONNREFUSED' };

      availability.paused.set(unreachable);
      fixture.detectChanges();
      expect(banner(element)?.getAttribute('data-state')).toBe('unreachable');
      expect(fixture.componentInstance.pausedMessage(unreachable)).toContain("can't reach this cluster");
    });

    it('no banner at the fleet level', async () => {
      const element = await setup(null, { fleetMode: true, userManager: true }, '/fleet');

      availability.paused.set(readOnly);
      fixture.detectChanges();
      expect(banner(element)).toBeNull();
    });

    it('reloads the access when the state flips (caps follow) and polls while signed in', async () => {
      await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });

      const loads = () => (accessFacade['load'] as jest.Mock).mock.calls.length;
      const before = loads();

      availability.availability.set({ ...readOnly, state: 'reachable' });
      fixture.detectChanges();
      // First known state after opening: the access was loaded with it already.
      expect(loads()).toBe(before);

      availability.availability.set(readOnly);
      fixture.detectChanges();
      expect(loads()).toBe(before + 1);

      expect(availability.start).toHaveBeenCalled();
    });

    it('single-cluster mode: no availability polling', async () => {
      await setup(clusterAdmin);

      expect(availability.start).not.toHaveBeenCalled();
    });
  });

  it('single-cluster mode: no fleet cluster load', async () => {
    await setup(clusterAdmin);

    expect(fleet['loadClusters']).not.toHaveBeenCalled();
  });

  describe('cluster section heading', () => {
    const heading = (element: HTMLElement): HTMLElement | null =>
      element.querySelector('[data-testid="console-nav-cluster-heading"]');

    it('fleet mode with a cluster: a separated, non-interactive label with the cluster name after the Fleet tile', async () => {
      const element = await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });
      const label = heading(element);

      expect(fixture.componentInstance.showClusterSection()).toBe(true);
      expect(label).not.toBeNull();
      expect(label?.textContent?.trim()).toBe('alpha');
      // Same separator as above Admin; a plain label, not a tile or popover trigger.
      expect(label?.classList).toContain('border-top');
      expect(label?.classList).toContain('border-bottom');
      expect(label?.classList).toContain('bg-body-secondary');
      expect(label?.classList).not.toContain('sidebar__item');
      expect(label?.querySelector('i')).toBeNull();
      expect(label?.hasAttribute('tabindex')).toBe(false);
      expect(label?.previousElementSibling?.getAttribute('data-testid')).toBe('console-nav-fleet-level');
      expect(element.querySelectorAll('[data-testid="console-nav-cluster-heading"]')).toHaveLength(1);
    });

    it('fleet mode without a cluster: no separator or label (nothing follows the Fleet group)', async () => {
      const element = await setup(null, { fleetMode: true, userManager: true });

      expect(fixture.componentInstance.showClusterSection()).toBe(false);
      expect(heading(element)).toBeNull();
    });

    it('fleet mode: the label appears when a cluster opens and goes when it is left', async () => {
      let element = await setup(clusterAdmin, { fleetMode: true });

      expect(heading(element)).toBeNull();

      fleet.activeClusterId.set(CLUSTER_A);
      fixture.detectChanges();
      element = fixture.nativeElement as HTMLElement;
      expect(heading(element)).not.toBeNull();

      fleet.activeClusterId.set(null);
      fixture.detectChanges();
      expect(heading(element)).toBeNull();
    });

    it('single-cluster mode: no separator or label', async () => {
      const element = await setup(clusterAdmin);

      expect(fixture.componentInstance.showClusterSection()).toBe(false);
      expect(heading(element)).toBeNull();
    });
  });

  describe('fleet level tile (3.37 P7: no "Back" swap)', () => {
    const tile = (element: HTMLElement): HTMLElement | null =>
      element.querySelector('[data-testid="console-nav-fleet-level"]');

    it('fleet mode with a cluster: a two-step Fleet tile leaves the cluster on the confirming click', async () => {
      const element = await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });
      const button = tile(element);

      expect(button?.tagName).toBe('BUTTON');
      expect(button?.querySelector('i.bi-globe2')).not.toBeNull();
      expect(button?.textContent?.trim()).toBe('Fleet');
      expect(button?.closest('fpc-sidebar-popover')).toBeNull();
      // The fleet pages are hidden while a cluster is open: no rail link to the fleet (the level tile is a button).
      expect(fleetLinks(element)).toEqual([]);

      const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      // First click arms: danger tile, sign-out icon, "Confirm" — nothing left yet.
      button?.click();
      fixture.detectChanges();
      expect(button?.classList).toContain('sidebar__item--confirm');
      expect(button?.querySelector('i.bi-box-arrow-left')).not.toBeNull();
      expect(button?.textContent?.trim()).toBe('Confirm');
      expect(button?.getAttribute('aria-label')).toBe('Click again to leave the cluster');
      expect(element.querySelector('[data-testid="console-nav-fleet-level-live"]')?.textContent?.trim()).toBe(
        'Click again to leave the cluster',
      );
      expect(fleet['leaveCluster']).not.toHaveBeenCalled();

      // Second click leaves and goes to the fleet level.
      button?.click();
      fixture.detectChanges();
      expect(fleet['leaveCluster']).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/fleet');
      expect(fleet['openCluster']).not.toHaveBeenCalled();
      expect(button?.classList).not.toContain('sidebar__item--confirm');
    });

    it('fleet tile confirm: reverts after ~3 s, on blur and on Escape without leaving', async () => {
      const element = await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });
      const button = tile(element) as HTMLButtonElement;
      const component = fixture.componentInstance;

      jest.useFakeTimers();
      try {
        button.click();
        expect(component.leaveConfirmArmed()).toBe(true);
        jest.advanceTimersByTime(3000);
        expect(component.leaveConfirmArmed()).toBe(false);

        button.click();
        button.dispatchEvent(new Event('blur'));
        expect(component.leaveConfirmArmed()).toBe(false);

        button.click();
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(component.leaveConfirmArmed()).toBe(false);
      } finally {
        jest.useRealTimers();
      }
      expect(fleet['leaveCluster']).not.toHaveBeenCalled();
    });

    it('fleet mode without a cluster and single-cluster mode: no fleet level tile', async () => {
      let element = await setup(null, { fleetMode: true, userManager: true });

      expect(tile(element)).toBeNull();
      expect(fleetLinks(element)).toContain('/fleet');

      TestBed.resetTestingModule();
      element = await setup(clusterAdmin);
      expect(tile(element)).toBeNull();
      expect(fleetLinks(element)).toEqual([]);
    });
  });

  it('fleet mode: the file browser needs the admin grant', async () => {
    await setup(
      { userId: null, clusterRole: 'infra-operator', projects: {} },
      { fleetMode: true, activeCluster: CLUSTER_A },
    );

    const paths = fixture.componentInstance.rail().flatMap((tile) => tile.items.map((item) => item.path));

    expect(paths).not.toContain('/operate/files');
    expect(paths).toContain('/operate/terminals');
  });
});
