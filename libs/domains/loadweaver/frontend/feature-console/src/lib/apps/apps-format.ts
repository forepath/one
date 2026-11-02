import type {
  AccessMe,
  AppCatalog,
  AppDataPolicy,
  AppManifest,
  AppPlanResult,
  AppSummary,
  CatalogAppVersion,
  InstalledApp,
  ManifestMigration,
  ProjectRole,
  SecretCondition,
  TrustLabel,
} from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

/**
 * App store (P1, Delivery › Apps): pure rules of the store, the app page, install / update / uninstall — role gating,
 * filters, versions, the plan target and the uninstall confirmation — so the components stay thin and the rules are
 * specced.
 */

// ------------------------------------------------------------------ installability

/**
 * Why projects can't install an app, readable: its trust label isn't allowed (`allowedTrust`), or the cluster is older
 * than the package's `minLoadweaver`.
 */
export function notInstallableText(
  app: Pick<AppSummary, 'notInstallableReason' | 'minLoadweaver' | 'loadweaverVersion'>,
): string {
  if (app.notInstallableReason === 'loadweaver-version') {
    const min = app.minLoadweaver ?? '';
    const version = app.loadweaverVersion ?? '';

    return $localize`:@@lwConsoleApps-notInstallableVersion:This app needs Loadweaver ${min}:minimum: or newer; this cluster runs ${version}:version:.`;
  }

  return $localize`:@@lwConsoleApps-notInstallable:The cluster doesn't allow installing apps with this trust label.`;
}

/** When a conditional secret is needed, readable (`only while stripeEnabled is true`). */
export function secretConditionText(condition: SecretCondition): string {
  const parameter = condition.parameter;
  const value = condition.equals === undefined ? 'true' : String(condition.equals);

  return $localize`:@@lwConsoleApps-secretCondition:only while ${parameter}:parameter: is ${value}:value:`;
}

// ------------------------------------------------------------------ trust labels

export const TRUST_TEXT: Record<TrustLabel, string> = {
  official: $localize`:@@lwConsoleApps-trustOfficial:Official`,
  verified: $localize`:@@lwConsoleApps-trustVerified:Verified publisher`,
  community: $localize`:@@lwConsoleApps-trustCommunity:Community`,
};

export const TRUST_HINT: Record<TrustLabel, string> = {
  official: $localize`:@@lwConsoleApps-trustOfficialHint:Curated and signed by ForePath`,
  verified: $localize`:@@lwConsoleApps-trustVerifiedHint:Signed by a publisher the catalog maintainers verified`,
  community: $localize`:@@lwConsoleApps-trustCommunityHint:Community submission, reviewed and signed by its publisher`,
};

export const TRUST_TONE: Record<TrustLabel, FpcBadgeTone> = {
  official: 'primary',
  verified: 'success',
  community: 'neutral',
};

export const TRUST_ICON: Record<TrustLabel, string> = {
  official: 'patch-check-fill',
  verified: 'patch-check',
  community: 'people',
};

export function trustText(trust: TrustLabel | null | undefined): string {
  return trust ? (TRUST_TEXT[trust] ?? trust) : '';
}

// ------------------------------------------------------------------ store

export interface AppFilters {
  q: string;
  catalog: string;
  trust: TrustLabel | '';
  category: string;
}

/** Store rows (the cluster already hides taken-down versions): search over title, name, summary, publisher, catalog, categories. */
export function filterApps(apps: readonly AppSummary[], filters: AppFilters): AppSummary[] {
  const terms = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return apps.filter((app) => {
    if (filters.catalog && app.catalog !== filters.catalog) return false;

    if (filters.trust && app.trust !== filters.trust) return false;

    if (filters.category && !(app.categories ?? []).includes(filters.category)) return false;

    const text = [app.title, app.name, app.summary, app.publisher, app.catalog, ...(app.categories ?? [])]
      .join(' ')
      .toLowerCase();

    return terms.every((t) => text.includes(t));
  });
}

/** The categories the listed apps carry (the filter only shows when there are any). */
export function appCategories(apps: readonly AppSummary[]): string[] {
  return [...new Set(apps.flatMap((a) => a.categories ?? []))].sort((a, b) => a.localeCompare(b));
}

/** Catalog filter options: the enabled catalogs, else the catalogs the apps name. */
export function catalogOptions(catalogs: readonly AppCatalog[], apps: readonly AppSummary[]): string[] {
  const enabled = catalogs.filter((c) => c.enabled).map((c) => c.name);

  return [...new Set([...enabled, ...apps.map((a) => a.catalog)])].sort((a, b) => a.localeCompare(b));
}

export function appKey(app: Pick<AppSummary, 'catalog' | 'name'>): string {
  return `${app.catalog}/${app.name}`;
}

/** The app page. */
export function appRoute(app: Pick<AppSummary, 'catalog' | 'name'>): string[] {
  return ['/delivery/apps', app.catalog, app.name];
}

export function appLink(app: Pick<AppSummary, 'catalog' | 'name'>): string {
  return `/delivery/apps/${encodeURIComponent(app.catalog)}/${encodeURIComponent(app.name)}`;
}

// ------------------------------------------------------------------ roles

const RANK: Record<ProjectRole, number> = { viewer: 0, developer: 1, operator: 2, admin: 3 };

/** The caller's role in `project` (cluster admins: admin; a fleet-wide grant counts in every project). */
export function appProjectRole(me: AccessMe | null | undefined, project: string): ProjectRole | null {
  if (!me) return null;

  if (me.clusterRole === 'cluster-admin') return 'admin';

  const own = me.projects[project];
  const fleet = me.allProjects;

  if (own && fleet) return RANK[own] >= RANK[fleet] ? own : fleet;

  return own ?? fleet ?? null;
}

/**
 * Install / update / uninstall like drafting a Deployment in the project: developer or higher (cluster admins
 * everywhere). Not during the fleet's read-only grace.
 */
export function mayPlanApp(me: AccessMe | null | undefined, project: string, readOnly = false): boolean {
  if (readOnly) return false;

  const role = appProjectRole(me, project);

  return !!role && RANK[role] >= RANK.developer;
}

/** The projects the caller may install into (`all`: every project, known to cluster admins / fleet-wide grants). */
export function installProjects(me: AccessMe | null | undefined, all: readonly string[], readOnly = false): string[] {
  if (!me || readOnly) return [];

  const candidates =
    me.clusterRole === 'cluster-admin' || me.allProjects
      ? [...all, ...Object.keys(me.projects)]
      : Object.keys(me.projects);

  return [...new Set(candidates)].filter((p) => mayPlanApp(me, p)).sort((a, b) => a.localeCompare(b));
}

/** Catalog settings and "Refresh catalogs": cluster admins. */
export function mayManageCatalogs(me: AccessMe | null | undefined): boolean {
  return me?.clusterRole === 'cluster-admin';
}

// ------------------------------------------------------------------ versions

function parts(version: string): { core: number[]; pre: string[] } {
  const [main, ...rest] = version.split('+')[0].split('-');

  return {
    core: main.split('.').map((n) => Number.parseInt(n, 10) || 0),
    pre: rest.length ? rest.join('-').split('.') : [],
  };
}

/** Semantic version order (pre-releases before their release). */
export function compareSemver(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);

  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);

    if (d !== 0) return d < 0 ? -1 : 1;
  }

  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;

  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];

    if (p === undefined) return -1;

    if (q === undefined) return 1;

    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);

    if (pn && qn && Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;

    if (pn !== qn) return pn ? -1 : 1;

    if (p !== q) return p < q ? -1 : 1;
  }

  return 0;
}

/** Newest first. */
export function sortVersions(versions: readonly CatalogAppVersion[]): CatalogAppVersion[] {
  return [...versions].sort((a, b) => compareSemver(b.version, a.version));
}

/** The channels in the versions, `stable` first. */
export function versionChannels(
  versions: readonly CatalogAppVersion[],
  manifestChannels: readonly string[] = [],
): string[] {
  const all = [...new Set([...manifestChannels, ...versions.map((v) => v.channel)])];

  return all.sort((a, b) => (a === 'stable' ? -1 : b === 'stable' ? 1 : a.localeCompare(b)));
}

/** The newest version on `channel`. */
export function latestOnChannel(versions: readonly CatalogAppVersion[], channel: string): CatalogAppVersion | null {
  return sortVersions(versions).find((v) => v.channel === channel) ?? null;
}

/** Update targets: newer than the installed version, newest first (any channel; the installed channel first). */
export function updateTargets(versions: readonly CatalogAppVersion[], current: string): CatalogAppVersion[] {
  return sortVersions(versions).filter((v) => compareSemver(v.version, current) > 0);
}

/** The target manifest's migrations that an update from `from` runs (to versions after `from`, up to the target). */
export function pendingMigrations(
  manifest: Pick<AppManifest, 'migrations' | 'version'>,
  from: string,
): ManifestMigration[] {
  return (manifest.migrations ?? [])
    .filter((m) => compareSemver(m.version, from) > 0 && compareSemver(m.version, manifest.version) <= 0)
    .sort((a, b) => compareSemver(a.version, b.version));
}

// ------------------------------------------------------------------ installed

export function installedKey(app: Pick<InstalledApp, 'project' | 'deployment'>): string {
  return `${app.project}/${app.deployment}`;
}

/** Newer versions in the installed channel are listed (newest first). */
export function hasUpdate(app: InstalledApp): boolean {
  return (app.updates?.length ?? 0) > 0;
}

/** The newest update in the installed channel. */
export function latestUpdate(app: InstalledApp): string | null {
  return app.updates?.[0]?.version ?? null;
}

/** The installed version (or the whole app) was taken down by its catalog. */
export function isTakenDown(app: InstalledApp): boolean {
  return !!app.takedown;
}

/** The catalog is disabled / unverified, or no longer lists the app: no updates from it. */
export function catalogUnavailable(app: InstalledApp): boolean {
  return !!app.availability && app.availability !== 'ok';
}

// ------------------------------------------------------------------ uninstall

export const DATA_POLICY_TEXT: Record<AppDataPolicy, { label: string; hint: string }> = {
  keep: {
    label: $localize`:@@lwConsoleApps-policyKeep:Keep the volumes`,
    hint: $localize`:@@lwConsoleApps-policyKeepHint:The app's services are removed; its volumes and their backups stay in the project.`,
  },
  backup: {
    label: $localize`:@@lwConsoleApps-policyBackupKeep:Final backup, keep the volumes`,
    hint: $localize`:@@lwConsoleApps-policyBackupApplyHint:Applying the plan backs up every volume first and removes the app only once all backups succeeded; a failed backup fails the plan and nothing is removed. The volumes stay in the project.`,
  },
  delete: {
    label: $localize`:@@lwConsoleApps-policyDelete:Delete the volumes`,
    hint: $localize`:@@lwConsoleApps-policyDeleteVolumesHint:The plan lists the app's volumes as deletions; they and their data are deleted for good once it is applied. Backups are not deleted: they follow their retention.`,
  },
};

/**
 * Uninstall needs an explicit choice (no default), and deleting the data additionally the deployment's name typed in
 * — the data is never deleted silently.
 */
export function uninstallReady(policy: AppDataPolicy | null, typed: string, deployment: string): boolean {
  if (!policy) return false;

  return policy !== 'delete' || typed.trim() === deployment;
}

// ------------------------------------------------------------------ plans

/** Where an install / update / uninstall goes next: the plan, else the draft (like other create flows). */
export function appPlanRoute(result: AppPlanResult | null | undefined): string[] | null {
  const plan = result?.planId ?? result?.plan?.id;

  if (plan) return ['/activity/plans', plan];

  const draft = result?.draftId ?? result?.draft?.id;

  return draft ? ['/activity/drafts', draft] : null;
}
