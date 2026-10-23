import { NO_ERRORS_SCHEMA } from '@angular/core';
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
  type FleetCluster,
} from '@forepath/loadweaver/frontend/data-access-console';
import { ENVIRONMENT, LocaleService } from '@forepath/loadweaver/frontend/util-configuration';
import { AdminUpdatesFacade } from '@forepath/shared/frontend/data-access-updates';
import { Component, signal } from '@angular/core';

import { CONSOLE_NAV, CONSOLE_NAV_ITEMS, activeConsoleNavPath, visibleConsoleNav } from '../console-nav';
import { LoadweaverSearchPaletteComponent } from '../search/search-palette.component';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverConsoleContainerComponent } from './container.component';

@Component({ standalone: true, template: '' })
class BlankComponent {}

const CLUSTER_A = '6f1c1b0e-0000-4000-8000-00000000000a';
const CLUSTER_B = '6f1c1b0e-0000-4000-8000-00000000000b';
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
  it('groups every item once and keeps the order by process', () => {
    const groups = CONSOLE_NAV.filter((entry) => 'items' in entry).map((entry) => ('items' in entry ? entry.id : ''));

    expect(groups).toEqual(['cluster', 'access', 'deploy', 'operate', 'observe', 'account']);
    expect(CONSOLE_NAV_ITEMS.slice(0, 2).map((item) => item.path)).toEqual(['/overview', '/topology']);
    expect(new Set(CONSOLE_NAV_ITEMS.map((item) => item.path)).size).toBe(CONSOLE_NAV_ITEMS.length);
  });

  it('hides groups without visible items and renders single-item groups as links', () => {
    const keys = visibleConsoleNav(CONSOLE_NAV, context).map((view) => view.key);

    // No cluster role: the cluster group's items are all infrastructure except DNS; Account only has Git accounts.
    expect(keys).toContain('/dns');
    expect(keys).not.toContain('group:cluster');
    expect(keys).toContain('/settings/git-accounts');
    expect(keys).not.toContain('group:account');
    // Access needs a role; Devices and Audit stay.
    expect(keys).toContain('group:access');

    const withRoles = visibleConsoleNav(CONSOLE_NAV, {
      ...context,
      infrastructure: true,
      me: clusterAdmin,
      patUi: true,
    });

    expect(withRoles.map((view) => view.key)).toEqual([
      '/overview',
      '/topology',
      'group:cluster',
      'group:access',
      'group:deploy',
      'group:operate',
      'group:observe',
      'group:account',
    ]);
  });

  it('matches the longest prefix (cluster updates vs. announcements, access requests)', () => {
    const items = [...CONSOLE_NAV_ITEMS, { path: '/updates/announcements', icon: '', label: '', title: '' }];

    expect(activeConsoleNavPath('/updates?tab=plans', items)).toBe('/updates');
    expect(activeConsoleNavPath('/updates/rollouts/r1', items)).toBe('/updates');
    expect(activeConsoleNavPath('/updates/announcements', items)).toBe('/updates/announcements');
    expect(activeConsoleNavPath('/projects/shop/requests', items)).toBe('/access');
    expect(activeConsoleNavPath('/de/backups/restores', items)).toBe('/backups');
    expect(activeConsoleNavPath('/search', items)).toBeNull();
  });
});

describe('LoadweaverConsoleContainerComponent', () => {
  let fixture: ComponentFixture<LoadweaverConsoleContainerComponent>;
  let auth: ReturnType<typeof facadeStub>;
  let updates: ReturnType<typeof facadeStub>;
  let fleet: ReturnType<typeof facadeStub> & { fleetMode: boolean; activeClusterId: ReturnType<typeof signal> };

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
      facadeStub(
        {
          clusters$: [
            { id: CLUSTER_A, name: 'alpha', state: 'active' },
            { id: CLUSTER_B, name: 'beta', state: 'retired' },
          ] as FleetCluster[],
        },
        ['loadClusters', 'openCluster', 'leaveCluster'],
      ),
      { fleetMode, activeClusterId: signal<string | null>(activeCluster) },
    );

    const access = accessStub(me);

    access['clear'] = jest.fn();

    TestBed.configureTestingModule({
      imports: [LoadweaverConsoleContainerComponent],
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        { provide: AuthenticationFacade, useValue: auth },
        { provide: ConsoleAccessFacade, useValue: access },
        { provide: AdminUpdatesFacade, useValue: updates },
        { provide: ConsoleFleetFacade, useValue: fleet },
        { provide: IDENTITY_AUTH_ENVIRONMENT, useValue: { authentication: { type } } },
        { provide: ENVIRONMENT, useValue: { application: { productName: 'Loadweaver' } } },
        {
          provide: LocaleService,
          useValue: { getAvailableLocales: () => [], getCurrentLocale: () => 'en', getLanguageSwitchUrl: () => '' },
        },
      ],
    });
    TestBed.overrideComponent(LoadweaverConsoleContainerComponent, {
      remove: { imports: [IdentityLogoutConfirmModalComponent, LoadweaverSearchPaletteComponent] },
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

  function trigger(element: HTMLElement, id: string): HTMLElement {
    return inGroup(element, id, '[fpcSidebarPopoverTrigger]') as HTMLElement;
  }

  it('renders the groups for a cluster admin, with Overview and Map as links', async () => {
    const element = await setup(clusterAdmin);
    const links = Array.from(element.querySelectorAll('fpc-sidebar > a, fpc-sidebar a.sidebar__item'))
      .filter((a) => !a.closest('fpc-sidebar-popover'))
      .map((a) => a.getAttribute('href'));

    expect(links).toEqual(['/overview', '/topology']);

    for (const id of ['cluster', 'access', 'deploy', 'operate', 'observe', 'account']) {
      const triggerElement = trigger(element, id);

      expect(triggerElement.getAttribute('role')).toBe('button');
      expect(triggerElement.getAttribute('tabindex')).toBe('0');
      expect(triggerElement.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('drops infrastructure-only groups and turns single-item groups into links for project members', async () => {
    const element = await setup(developer, { type: 'api-key' });

    expect(group(element, 'cluster')).toBeNull();
    expect(element.querySelector('a[href="/dns"]')?.closest('fpc-sidebar-popover')).toBeNull();
    // api-key: no PAT UI, so Account only has Git accounts.
    expect(group(element, 'account')).toBeNull();
    expect(element.querySelector('[data-testid="console-git-accounts"]')?.closest('fpc-sidebar-popover')).toBeNull();
  });

  it('marks the group of the current route active and opens one popover at a time', async () => {
    const element = await setup(clusterAdmin, {}, '/updates/rollouts/r1');

    expect(trigger(element, 'cluster').classList).toContain('active');
    expect(trigger(element, 'observe').classList).not.toContain('active');

    trigger(element, 'observe').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(inGroup(element, 'observe', '[role="dialog"]')).not.toBeNull();

    trigger(element, 'deploy').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.openPopover()).toBe('deploy');
    expect(inGroup(element, 'observe', '[role="dialog"]')).toBeNull();

    (inGroup(element, 'deploy', 'a[href="/git"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.openPopover()).toBeNull();
  });

  it('shows the admin Updates item (with the attention badge) only to global admins', async () => {
    let element = await setup(clusterAdmin, { userManager: false });

    expect(fixture.componentInstance.adminNavItems().map((item) => item.path)).toEqual(['/webhooks']);
    expect(updates['loadStatus']).not.toHaveBeenCalled();
    expect(inGroup(element, 'admin', 'fpc-notification-indicator')).toBeNull();

    TestBed.resetTestingModule();
    element = await setup(clusterAdmin, { userManager: true, attention: true }, '/updates/announcements');

    expect(fixture.componentInstance.adminNavItems().map((item) => item.path)).toEqual([
      '/webhooks',
      '/users',
      '/updates/announcements',
    ]);
    expect(updates['loadStatus']).toHaveBeenCalled();
    expect(trigger(element, 'admin').classList).toContain('active');
    expect(trigger(element, 'cluster').classList).not.toContain('active');
    expect(trigger(element, 'admin').querySelector('fpc-notification-indicator')).not.toBeNull();
  });

  it('fleet mode without a cluster: only the Fleet group and a cluster switcher', async () => {
    const element = await setup(null, { fleetMode: true, userManager: true });

    expect(fleet['loadClusters']).toHaveBeenCalled();
    expect(group(element, 'fleet')).not.toBeNull();
    expect(group(element, 'cluster')).toBeNull();
    expect(fixture.componentInstance.nav().map((view) => view.key)).toEqual(['group:fleet']);
    // The cluster's own admin features aren't reached through the fleet; the fleet's users are.
    expect(fixture.componentInstance.adminNavItems().map((item) => item.path)).toEqual(['/users']);
    // Retired connections can't be opened.
    expect(fixture.componentInstance.switchableClusters().map((c) => c.name)).toEqual(['alpha']);
    expect(element.querySelector('[data-testid="console-cluster-switcher"]')).not.toBeNull();

    fixture.componentInstance.onClusterSwitch(CLUSTER_A);
    expect(fleet['openCluster']).toHaveBeenCalledWith(CLUSTER_A);
  });

  it('fleet mode with a cluster: the cluster sidebar minus what the relay never carries', async () => {
    const element = await setup(clusterAdmin, { fleetMode: true, activeCluster: CLUSTER_A });
    const paths = fixture.componentInstance
      .nav()
      .flatMap((view) => (view.kind === 'link' ? [view.item.path] : view.items.map((item) => item.path)));

    expect(paths[0]).toBe('/fleet');
    expect(paths).toContain('/plans');
    expect(paths).toContain('/files');
    expect(paths).not.toContain('/git');
    expect(paths).not.toContain('/devices');
    expect(paths).not.toContain('/settings/git-accounts');
    expect(group(element, 'deploy')).not.toBeNull();

    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.onClusterSwitch('');
    expect(fleet['leaveCluster']).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/fleet');
  });

  it('fleet mode: the file browser needs the admin grant', async () => {
    await setup(
      { userId: null, clusterRole: 'infra-operator', projects: {} },
      { fleetMode: true, activeCluster: CLUSTER_A },
    );

    const paths = fixture.componentInstance
      .nav()
      .flatMap((view) => (view.kind === 'link' ? [view.item.path] : view.items.map((item) => item.path)));

    expect(paths).not.toContain('/files');
    expect(paths).toContain('/terminals');
  });
});
