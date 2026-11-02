import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type Route, Router } from '@angular/router';
import {
  type AccessMe,
  type AppDetail,
  AppStoreService,
  ConsoleAccessFacade,
  ConsoleAccessManagementFacade,
  type InstalledApp,
  SecretsService,
} from '@forepath/loadweaver/frontend/data-access-console';
import { MarkdownParserService } from '@forepath/shared/frontend/util-docs-parser';
import { BehaviorSubject, of, throwError } from 'rxjs';

import { loadweaverConsoleRoutes } from '../loadweaver-console.routes';
import { accessStub, facadeStub } from '../testing';
import { LoadweaverAppInstallModalComponent } from './app-install-modal.component';
import { LoadweaverAppPageComponent } from './app-page.component';
import { LoadweaverAppUninstallModalComponent } from './app-uninstall-modal.component';
import { LoadweaverAppUpdateModalComponent } from './app-update-modal.component';
import { LoadweaverAppsPageComponent } from './apps-page.component';
import { testApp, testDetail, testInstalled, testManifest } from './apps-testing';

type ApiStub = Record<
  'catalogs' | 'refreshCatalogs' | 'apps' | 'app' | 'installPlan' | 'installed' | 'updatePlan' | 'uninstallPlan',
  jest.Mock
>;

function apiStub(detail: AppDetail = testDetail()): ApiStub {
  return {
    catalogs: jest.fn(() =>
      of({
        catalogs: [
          { name: 'official', type: 'oci', url: 'oci://r/official', enabled: true },
          { name: 'community', type: 'git', url: 'https://g/c', enabled: true, error: 'signature mismatch' },
        ],
        allowedTrust: ['official', 'verified'],
      }),
    ),
    refreshCatalogs: jest.fn(() => of([])),
    apps: jest.fn(() =>
      of([
        testApp(),
        testApp({
          catalog: 'community',
          name: 'wiki',
          title: 'Wiki',
          trust: 'community',
          deprecated: true,
          installable: false,
          notInstallableReason: 'trust',
        }),
      ]),
    ),
    app: jest.fn((_c: string, _a: string, version?: string) =>
      of(version && version !== detail.manifest.version ? { ...detail, manifest: testManifest({ version }) } : detail),
    ),
    installPlan: jest.fn(() => of({ action: 'install', draft: { id: 'd1' } })),
    installed: jest.fn(() => of([testInstalled()])),
    updatePlan: jest.fn(() => of({ action: 'update', draft: { id: 'd2' } })),
    uninstallPlan: jest.fn(() => of({ action: 'uninstall', draft: { id: 'd3' } })),
  };
}

const developer: AccessMe = { userId: 'u', clusterRole: null, projects: { shop: 'developer', blog: 'viewer' } };
const viewer: AccessMe = { userId: 'u', clusterRole: null, projects: { shop: 'viewer' } };
const admin: AccessMe = { userId: 'a', clusterRole: 'cluster-admin', projects: {} };

function providers(api: ApiStub, me: AccessMe, extra: unknown[] = []) {
  return [
    provideRouter([]),
    { provide: AppStoreService, useValue: api },
    { provide: ConsoleAccessFacade, useValue: accessStub(me) },
    { provide: ConsoleAccessManagementFacade, useValue: facadeStub({ projects$: ['blog', 'shop'] }, ['loadProjects']) },
    { provide: SecretsService, useValue: { listNames: jest.fn(() => of({ items: [] })) } },
    ...extra,
  ];
}

describe('Delivery › Apps (P1)', () => {
  describe('store and installed apps', () => {
    async function setup(me: AccessMe, api = apiStub(), params: Record<string, string> = {}) {
      const route = { snapshot: { paramMap: convertToParamMap(params), queryParamMap: convertToParamMap({}) } };

      await TestBed.configureTestingModule({
        imports: [LoadweaverAppsPageComponent],
        providers: providers(api, me, Object.keys(params).length ? [{ provide: ActivatedRoute, useValue: route }] : []),
      }).compileComponents();

      const fixture = TestBed.createComponent(LoadweaverAppsPageComponent);

      fixture.detectChanges();

      return { page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, api };
    }

    it('lists the store, marks deprecated apps and shows failing catalogs', async () => {
      const { page, el } = await setup(developer);

      expect(page.visibleApps().map((a) => a.name)).toEqual(['agenstra', 'wiki']);
      expect(el.querySelector('[data-testid="apps-store"]')?.textContent).toContain('Agenstra');
      expect(el.querySelector('[data-testid="apps-deprecated"]')).not.toBeNull();
      // Not installable: a badge with the reason as its tooltip (no lane counters).
      expect(el.querySelector('[data-testid="apps-not-installable"]')?.getAttribute('title')).toContain('trust label');
      expect(el.querySelectorAll('[data-testid="app-trust-badge"]').length).toBeGreaterThan(0);
      expect(el.querySelector('[data-testid="apps-catalog-error"]')?.textContent).toContain('signature mismatch');

      page.trust.set('community');
      expect(page.visibleApps().map((a) => a.name)).toEqual(['wiki']);
    });

    it('carries ?project= to the app page', async () => {
      const { page } = await setup(developer);

      page.project.set('shop');
      expect(page.appRowLink(testApp())).toBe('/delivery/apps/official/agenstra?project=shop');
    });

    it('offers Update / Uninstall only where the caller may draft the Deployment', async () => {
      const { page } = await setup(developer);
      const ids = (app: InstalledApp) => page.installedMenu(app).map((i) => i.id);

      expect(ids(testInstalled())).toEqual(['app', 'deployment', 'update', 'uninstall']);
      expect(ids(testInstalled({ project: 'blog' }))).toEqual(['app', 'deployment']);
      expect(ids(testInstalled({ availability: 'catalog-unavailable' }))).toEqual(['app', 'deployment', 'uninstall']);
      expect(ids(testInstalled({ updates: [] }))).toEqual(['app', 'deployment', 'uninstall']);

      page.onInstalledAction(testInstalled(), 'uninstall');
      expect(page.uninstallFor()?.deployment).toBe('agenstra');
    });

    it('shows Refresh catalogs to cluster admins only', async () => {
      const dev = await setup(developer);

      expect(dev.el.querySelector('[data-testid="apps-refresh-catalogs"]')).toBeNull();
      dev.page.refreshCatalogs();
      expect(dev.api.refreshCatalogs).not.toHaveBeenCalled();
      TestBed.resetTestingModule();

      const adm = await setup(admin);

      expect(adm.el.querySelector('[data-testid="apps-refresh-catalogs"]')).not.toBeNull();
      adm.page.refreshCatalogs();
      expect(adm.api.refreshCatalogs).toHaveBeenCalled();
      expect(adm.page.notice()?.tone).toBe('success');
    });

    it('routes /delivery/apps/installed/:project/:deployment (inbox takedown links) to the Apps page', () => {
      const found: Route[] = [];
      const walk = (routes: Route[]) =>
        routes.forEach((r) => {
          if (r.path === 'apps/installed/:project/:deployment') found.push(r);

          if (r.children) walk(r.children);
        });

      walk(loadweaverConsoleRoutes);
      expect(found).toHaveLength(1);
      expect(found[0].component).toBe(LoadweaverAppsPageComponent);
    });

    it('opens the Installed lane with the linked installation active', async () => {
      const api = apiStub();

      api.installed.mockReturnValue(
        of([testInstalled(), testInstalled({ deployment: 'old', takedown: { reason: 'CVE', at: '2026-10-30' } })]),
      );
      const { page, el } = await setup(developer, api, { project: 'shop', deployment: 'old' });

      expect(page.lane()).toBe('installed');
      expect(page.focusedInstall()).toBe('shop/old');
      expect(page.visibleInstalled().map((i) => i.deployment)).toEqual(['old']);
      expect(el.querySelector('[data-testid="apps-installed"] tr.table-active')?.textContent).toContain('shop/old');
    });

    it('starts on the Store lane without route parameters', async () => {
      const { page } = await setup(developer);

      expect(page.lane()).toBe('store');
      expect(page.focusedInstall()).toBeNull();
      expect(page.installedSearch()).toBe('');
    });

    it('flags taken-down and updatable installs', async () => {
      const api = apiStub();

      api.installed.mockReturnValue(
        of([
          testInstalled(),
          testInstalled({ deployment: 'old', takedown: { reason: 'CVE-2026-1', at: '2026-10-30T00:00:00Z' } }),
        ]),
      );
      const { el } = await setup(viewer, api);

      expect(el.querySelector('[data-testid="apps-update-available"]')?.textContent).toContain('1.2.0');
      expect(el.querySelector('[data-testid="apps-taken-down"]')?.getAttribute('title')).toBe('CVE-2026-1');
    });
  });

  describe('app page', () => {
    async function setup(me: AccessMe, query: Record<string, string> = {}, api = apiStub()) {
      const markdown = { parseMarkdown: jest.fn(async (c: string) => ({ html: `<h1>${c.length}</h1>` })) };

      await TestBed.configureTestingModule({
        imports: [LoadweaverAppPageComponent],
        providers: providers(api, me, [
          { provide: MarkdownParserService, useValue: markdown },
          {
            provide: ActivatedRoute,
            useValue: {
              paramMap: new BehaviorSubject(convertToParamMap({ catalog: 'official', app: 'agenstra' })),
              queryParamMap: new BehaviorSubject(convertToParamMap(query)),
              snapshot: { queryParamMap: convertToParamMap(query) },
            },
          },
        ]),
      }).compileComponents();

      const fixture = TestBed.createComponent(LoadweaverAppPageComponent);

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      return { page: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, api, markdown };
    }

    it('shows versions, the rendered README, parameters, secrets, dependencies and suggestions', async () => {
      const { page, el, api, markdown } = await setup(developer);

      expect(api.app).toHaveBeenCalledWith('official', 'agenstra');
      expect(markdown.parseMarkdown).toHaveBeenCalledWith('# Agenstra\n\nHello.', 'README.md');
      expect(el.querySelector('[data-testid="app-readme"]')?.innerHTML).toContain('<h1>');
      expect(page.versions().map((v) => v.version)).toEqual(['1.3.0-beta.1', '1.2.0', '1.0.0']);
      expect(el.querySelector('[data-testid="app-parameters"]')?.textContent).toContain('Domain');
      expect(el.querySelector('[data-testid="app-secrets"]')?.textContent).toContain('admin-password');
      expect(el.querySelector('[data-testid="app-dependencies"]')?.textContent).toContain('PostgreSQL');
      expect(el.querySelector('[data-testid="app-suggestions"]')?.textContent).toContain('Policy agenstra-ingress');
      expect(page.installBlocked()).toBe(false);
    });

    it('blocks Install without a project role or when the trust label is not allowed', async () => {
      const blocked = await setup(viewer);

      expect(blocked.page.installBlocked()).toBe(true);
      TestBed.resetTestingModule();

      const api = apiStub(testDetail({ installable: false }));
      const notAllowed = await setup(developer, {}, api);

      expect(notAllowed.page.installBlocked()).toBe(true);
      expect(notAllowed.page.notInstallableLabel()).toContain('trust label');
    });

    it('blocks Install with the reason when the cluster is older than minLoadweaver', async () => {
      const api = apiStub(
        testDetail({
          installable: false,
          notInstallableReason: 'loadweaver-version',
          minLoadweaver: '4.2.0',
          loadweaverVersion: '4.1.0',
        }),
      );
      const { page, el } = await setup(developer, {}, api);

      expect(page.installBlocked()).toBe(true);
      expect(el.textContent).toContain('This app needs Loadweaver 4.2.0 or newer; this cluster runs 4.1.0.');
    });

    it('opens Install directly with ?install=1 and pre-selects ?project=', async () => {
      const { page } = await setup(admin, { install: '1', project: 'shop' });

      expect(page.installOpen()).toBe(true);
      expect(page.presetProject()).toBe('shop');
      expect(page.projects()).toEqual(['blog', 'shop']);
    });
  });

  describe('install modal', () => {
    @Component({
      standalone: true,
      imports: [LoadweaverAppInstallModalComponent],
      template: `<loadweaver-app-install-modal
        [(open)]="open"
        [detail]="detail"
        [projects]="projects"
        project="shop"
      />`,
    })
    class HostComponent {
      readonly open = signal(true);
      detail = testDetail();
      projects = ['blog', 'shop'];
    }

    async function setup(api = apiStub()) {
      await TestBed.configureTestingModule({
        imports: [HostComponent],
        providers: providers(api, developer),
      }).compileComponents();

      const fixture = TestBed.createComponent(HostComponent);

      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const modal = fixture.debugElement.children[0].componentInstance as LoadweaverAppInstallModalComponent;

      return { fixture, modal, api, host: fixture.componentInstance };
    }

    it('generates the form from the manifest with the defaults and the pre-selected project', async () => {
      const { modal, fixture } = await setup();
      const body = document.body;

      expect(modal.selectedProject()).toBe('shop');
      expect(modal.version()).toBe('1.2.0');
      expect(modal.channels()).toEqual(['stable', 'beta']);
      expect(modal.values()).toEqual({ replicas: 1, bundledPostgres: true });
      expect(body.querySelector('[data-testid="app-install-param-domain"]')).not.toBeNull();
      expect(body.querySelector('[data-testid="app-install-param-postgresUrl"]')).toBeNull();

      modal.setBundled(modal.model().dependencies[0], false);
      fixture.detectChanges();
      expect(body.querySelector('[data-testid="app-install-param-postgresUrl"]')).not.toBeNull();
      expect(modal.selected()).toEqual(new Set(['policies', 'dns', 'backups']));
    });

    it('refuses to plan until required parameters and secrets are set, then opens the draft', async () => {
      const { modal, api } = await setup();
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      modal.submit();
      expect(api.installPlan).not.toHaveBeenCalled();
      expect(modal.shownIssues().map((i) => i.path)).toEqual([['domain']]);
      expect(modal.missing()).toEqual(['admin-password']);

      modal.setValue('domain', 'agenstra.example');
      modal.setSecret('admin-password', 'agenstra-admin');
      modal.toggleSuggestion('policies', false);
      modal.submit();

      expect(api.installPlan).toHaveBeenCalledWith('official', 'agenstra', '1.2.0', {
        project: 'shop',
        parameters: { domain: 'agenstra.example', replicas: 1, bundledPostgres: true },
        secrets: { 'admin-password': 'secret://shop/agenstra-admin' },
        suggestions: ['dns', 'backups'],
      });
      expect(navigate).toHaveBeenCalledWith(['/activity/drafts', 'd1']);
      expect(modal.open()).toBe(false);
    });

    it('loads the manifest of another version and keeps the entered values', async () => {
      const { modal, api } = await setup();

      modal.setValue('domain', 'x.example');
      modal.setChannel('beta');

      expect(modal.version()).toBe('1.3.0-beta.1');
      expect(api.app).toHaveBeenCalledWith('official', 'agenstra', '1.3.0-beta.1');
      expect(modal.manifest()?.version).toBe('1.3.0-beta.1');
      expect(modal.values()['domain']).toBe('x.example');
    });

    it('shows the API error when the plan is refused', async () => {
      const api = apiStub();

      api.installPlan.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'developer role required' } })),
      );
      const { modal } = await setup(api);

      modal.setValue('domain', 'a.example');
      modal.setSecret('admin-password', 'pw');
      modal.submit();
      expect(modal.error()).toContain('developer role required');
      expect(modal.open()).toBe(true);
    });
  });

  describe('update and uninstall', () => {
    @Component({
      standalone: true,
      imports: [LoadweaverAppUpdateModalComponent, LoadweaverAppUninstallModalComponent],
      template: `
        <loadweaver-app-update-modal [(open)]="updateOpen" [app]="app" />
        <loadweaver-app-uninstall-modal [(open)]="uninstallOpen" [app]="app" />
      `,
    })
    class HostComponent {
      readonly updateOpen = signal(false);
      readonly uninstallOpen = signal(false);
      app = testInstalled();
    }

    async function setup(api = apiStub()) {
      await TestBed.configureTestingModule({
        imports: [HostComponent],
        providers: providers(api, developer),
      }).compileComponents();

      const fixture = TestBed.createComponent(HostComponent);

      fixture.detectChanges();

      const [update, uninstall] = fixture.debugElement.children.map((c) => c.componentInstance) as [
        LoadweaverAppUpdateModalComponent,
        LoadweaverAppUninstallModalComponent,
      ];

      return { fixture, update, uninstall, api, host: fixture.componentInstance };
    }

    it('offers newer versions (installed channel first), notes backup-first + migrations and plans the update', async () => {
      const { fixture, update, api, host } = await setup();
      const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      host.updateOpen.set(true);
      fixture.detectChanges();

      expect(update.targets().map((v) => v.version)).toEqual(['1.2.0', '1.3.0-beta.1']);
      expect(update.version()).toBe('1.2.0');
      expect(update.migrations().map((m) => m.version)).toEqual(['1.1.0', '1.2.0']);
      expect(document.querySelector('[data-testid="app-update-backup"]')?.textContent).toContain('backs up the app');

      update.submit();
      expect(api.updatePlan).toHaveBeenCalledWith('shop', 'agenstra', { version: '1.2.0' });
      expect(navigate).toHaveBeenCalledWith(['/activity/drafts', 'd2']);
    });

    it('asks for the data policy every time and needs the name typed to delete data', async () => {
      const { fixture, uninstall, api, host } = await setup();

      jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      host.uninstallOpen.set(true);
      fixture.detectChanges();

      expect(uninstall.policy()).toBeNull();
      uninstall.submit();
      expect(api.uninstallPlan).not.toHaveBeenCalled();

      uninstall.policy.set('delete');
      fixture.detectChanges();
      // Deleting: the volumes go once the plan is applied; backups are kept.
      expect(document.querySelector('[data-testid="app-uninstall-delete-note"]')?.textContent).toContain(
        'Backups of the volumes are not deleted',
      );
      uninstall.typed.set('wrong');
      uninstall.submit();
      expect(api.uninstallPlan).not.toHaveBeenCalled();

      uninstall.typed.set('agenstra');
      uninstall.submit();
      expect(api.uninstallPlan).toHaveBeenCalledWith('shop', 'agenstra', { dataPolicy: 'delete', confirm: 'agenstra' });
      fixture.detectChanges();
      expect(host.uninstallOpen()).toBe(false);

      host.uninstallOpen.set(true);
      fixture.detectChanges();
      expect(uninstall.policy()).toBeNull();
    });
  });
});
