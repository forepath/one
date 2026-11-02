import type { AccessMe } from '@forepath/loadweaver/frontend/data-access-console';

import {
  appCategories,
  appLink,
  appPlanRoute,
  catalogOptions,
  catalogUnavailable,
  compareSemver,
  filterApps,
  hasUpdate,
  installProjects,
  isTakenDown,
  latestOnChannel,
  latestUpdate,
  mayManageCatalogs,
  mayPlanApp,
  notInstallableText,
  pendingMigrations,
  uninstallReady,
  updateTargets,
  versionChannels,
} from './apps-format';
import { testApp, testDetail, testInstalled, testManifest } from './apps-testing';

const me = (patch: Partial<AccessMe>): AccessMe => ({ userId: 'u1', clusterRole: null, projects: {}, ...patch });

describe('app store rules (P1)', () => {
  describe('roles', () => {
    it('installs / updates / uninstalls like drafting a Deployment: developer+ in the project, cluster admins anywhere', () => {
      const dev = me({ projects: { shop: 'developer', blog: 'viewer' } });

      expect(mayPlanApp(dev, 'shop')).toBe(true);
      expect(mayPlanApp(dev, 'blog')).toBe(false);
      expect(mayPlanApp(dev, 'other')).toBe(false);
      expect(mayPlanApp(dev, 'shop', true)).toBe(false);
      expect(mayPlanApp(me({ clusterRole: 'cluster-admin' }), 'any')).toBe(true);
      expect(mayPlanApp(me({ clusterRole: 'infra-operator' }), 'any')).toBe(false);
      expect(mayPlanApp(me({ allProjects: 'operator' }), 'any')).toBe(true);
      expect(mayPlanApp(null, 'shop')).toBe(false);
    });

    it('offers the installable projects (all projects for cluster admins)', () => {
      expect(installProjects(me({ projects: { shop: 'admin', blog: 'viewer', api: 'developer' } }), ['x'])).toEqual([
        'api',
        'shop',
      ]);
      expect(installProjects(me({ clusterRole: 'cluster-admin' }), ['b', 'a'])).toEqual(['a', 'b']);
      expect(installProjects(me({ projects: { shop: 'admin' } }), [], true)).toEqual([]);
    });

    it('leaves catalog settings and refresh to cluster admins', () => {
      expect(mayManageCatalogs(me({ clusterRole: 'cluster-admin' }))).toBe(true);
      expect(mayManageCatalogs(me({ clusterRole: 'infra-operator' }))).toBe(false);
      expect(mayManageCatalogs(me({ projects: { shop: 'admin' } }))).toBe(false);
    });
  });

  describe('store', () => {
    const apps = [
      testApp(),
      testApp({ catalog: 'community', name: 'wiki', title: 'Wiki', trust: 'community', categories: ['docs'] }),
      testApp({ catalog: 'acme', name: 'crm', title: 'CRM', publisher: 'Acme', trust: 'verified', deprecated: true }),
    ];
    const none = { q: '', catalog: '', trust: '' as const, category: '' };

    it('filters by search, catalog, trust and category', () => {
      expect(filterApps(apps, none).map((a) => a.name)).toEqual(['agenstra', 'wiki', 'crm']);
      expect(filterApps(apps, { ...none, q: 'acme' }).map((a) => a.name)).toEqual(['crm']);
      expect(filterApps(apps, { ...none, catalog: 'community' }).map((a) => a.name)).toEqual(['wiki']);
      expect(filterApps(apps, { ...none, trust: 'verified' }).map((a) => a.name)).toEqual(['crm']);
      expect(filterApps(apps, { ...none, category: 'docs' }).map((a) => a.name)).toEqual(['wiki']);
      expect(appCategories(apps)).toEqual(['docs']);
    });

    it('lists enabled catalogs and the ones apps name; links the app page', () => {
      expect(
        catalogOptions(
          [
            { name: 'official', type: 'oci', url: 'oci://r/x', enabled: true },
            { name: 'off', type: 'git', url: 'https://g', enabled: false },
          ],
          apps,
        ),
      ).toEqual(['acme', 'community', 'official']);
      expect(appLink({ catalog: 'my cat', name: 'a' })).toBe('/delivery/apps/my%20cat/a');
    });
  });

  describe('versions', () => {
    it('orders semantic versions with pre-releases first', () => {
      expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0);
      expect(compareSemver('1.3.0-beta.1', '1.3.0')).toBeLessThan(0);
      expect(compareSemver('1.3.0-beta.2', '1.3.0-beta.10')).toBeLessThan(0);
      expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
    });

    it('derives channels, the latest per channel, update targets and pending migrations', () => {
      const { versions } = testDetail();

      expect(versionChannels(versions, ['beta', 'stable'])).toEqual(['stable', 'beta']);
      expect(latestOnChannel(versions, 'stable')?.version).toBe('1.2.0');
      expect(updateTargets(versions, '1.0.0').map((v) => v.version)).toEqual(['1.3.0-beta.1', '1.2.0']);
      expect(pendingMigrations(testManifest(), '1.0.0').map((m) => m.version)).toEqual(['1.1.0', '1.2.0']);
      expect(pendingMigrations(testManifest(), '1.1.0').map((m) => m.version)).toEqual(['1.2.0']);
    });

    it('flags updates, takedowns and unavailable catalogs of installed apps', () => {
      expect(hasUpdate(testInstalled())).toBe(true);
      expect(latestUpdate(testInstalled())).toBe('1.2.0');
      expect(hasUpdate(testInstalled({ updates: [] }))).toBe(false);
      expect(isTakenDown(testInstalled({ takedown: { reason: 'CVE', at: '2026-10-30' } }))).toBe(true);
      expect(isTakenDown(testInstalled())).toBe(false);
      expect(catalogUnavailable(testInstalled({ availability: 'missing' }))).toBe(true);
      expect(catalogUnavailable(testInstalled())).toBe(false);
    });
  });

  it('never uninstalls without an explicit data policy; deleting needs the deployment name', () => {
    expect(uninstallReady(null, '', 'agenstra')).toBe(false);
    expect(uninstallReady('keep', '', 'agenstra')).toBe(true);
    expect(uninstallReady('backup', '', 'agenstra')).toBe(true);
    expect(uninstallReady('delete', 'agen', 'agenstra')).toBe(false);
    expect(uninstallReady('delete', ' agenstra ', 'agenstra')).toBe(true);
  });

  it('names why an app is not installable: the trust label, or a cluster older than minLoadweaver', () => {
    expect(notInstallableText({ notInstallableReason: 'trust' })).toContain('trust label');
    expect(notInstallableText({})).toContain('trust label');
    expect(
      notInstallableText({
        notInstallableReason: 'loadweaver-version',
        minLoadweaver: '4.2.0',
        loadweaverVersion: '4.1.0',
      }),
    ).toBe('This app needs Loadweaver 4.2.0 or newer; this cluster runs 4.1.0.');
  });

  it('opens the plan, else the draft the API created', () => {
    expect(appPlanRoute({ planId: 'p1', draftId: 'd1' })).toEqual(['/activity/plans', 'p1']);
    expect(appPlanRoute({ plan: { id: 'p2' } })).toEqual(['/activity/plans', 'p2']);
    expect(appPlanRoute({ draft: { id: 'd2' } })).toEqual(['/activity/drafts', 'd2']);
    expect(appPlanRoute({})).toBeNull();
  });
});
