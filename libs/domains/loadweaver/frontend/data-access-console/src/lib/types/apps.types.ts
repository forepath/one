/**
 * App store (P1, 2026-10-31): the control plane's `/apps` API (relayed by the fleet like every page). The package /
 * index / config formats are defined by `@forepath/loadweaver/shared/util-app-catalog`. The console does not import
 * that lib at all (its archive / signing helpers need Node, and its sources don't type-check under the console's
 * compiler settings), so the shapes the console reads are mirrored here structurally.
 */

/** `TrustLabel` of the shared lib. */
export type TrustLabel = 'official' | 'verified' | 'community';

/** `CatalogType` of the shared lib. */
export type CatalogType = 'oci' | 'git' | 'fleet';

/** `ParameterValue` of the shared lib. */
export type ParameterValue = string | number | boolean;

/** `ParameterSchema`: a scalar JSON Schema (other keywords such as `enum`, `minimum`, `pattern` drive the form). */
export interface ParameterSchema {
  type: 'string' | 'integer' | 'number' | 'boolean';
  title?: string;
  description?: string;
  default?: ParameterValue;
  [keyword: string]: unknown;
}

export interface ManifestParameters {
  type: 'object';
  properties: Record<string, ParameterSchema>;
  required: string[];
  [keyword: string]: unknown;
}

/** A conditional secret's condition: a boolean parameter is `true`, or the parameter equals `equals`. */
export interface SecretCondition {
  parameter: string;
  equals?: ParameterValue;
}

export interface ManifestSecret {
  name: string;
  description: string;
  /** Needed only while the condition holds (otherwise left out of the install). */
  requiredWhen?: SecretCondition;
}

/** `bundled`: part of the compose, toggled by the boolean `parameter`; `provided`: connection parameters. */
export interface ManifestDependency {
  name: string;
  title?: string;
  bundled?: { parameter: string; services: string[]; volumes: string[] };
  provided?: { parameters: string[] };
}

/** Draft resources the install plan suggests, per group (Loadweaver resource documents). */
export interface ManifestSuggestions {
  groups: Record<string, unknown>[];
  policies: Record<string, unknown>[];
  ingress: Record<string, unknown>[];
  dns: Record<string, unknown>[];
}

export interface ManifestBackup {
  name: string;
  schedule: string;
  volumes: string[];
  retention?: string;
  description?: string;
}

export interface ManifestMigration {
  version: string;
  description?: string;
  steps: { name: string; service: string; command: string[]; phase: 'before' | 'after' }[];
}

/** `AppManifest` (`manifest.yaml`) as the console reads it (defaults applied by the cluster). */
export interface AppManifest {
  apiVersion: string;
  name: string;
  version: string;
  title: string;
  description: string;
  publisher: string;
  license: string;
  homepage: string;
  docs: string;
  icon?: string;
  channels: string[];
  parameters: ManifestParameters;
  secrets: ManifestSecret[];
  dependencies: ManifestDependency[];
  suggestions: ManifestSuggestions;
  backups: ManifestBackup[];
  healthChecks?: unknown[];
  migrations: ManifestMigration[];
  exceptions?: { rule: string; service?: string; reason: string }[];
  minLoadweaver?: string;
}

/** `CatalogAppVersion` of the index. */
export interface CatalogAppVersion {
  version: string;
  channel: string;
  digest: string;
  published: string;
}

/** The trust labels in rank order (`TRUST_LABELS` of the shared lib). */
export const APP_TRUST_LABELS: readonly TrustLabel[] = ['official', 'verified', 'community'];

/** `GET /apps/catalogs`: one configured catalog source (`Cluster.spec.appStore.catalogs[]`) and its refresh state. */
export interface AppCatalog {
  name: string;
  type: CatalogType;
  /** Without credentials, query or fragment. */
  url: string;
  ref?: string | null;
  official?: boolean;
  /**
   * The fixed entry of a trusted fleet's catalog (2026-11-01): always enabled, not removable while the cluster trusts
   * the fleet; `fleet` names it.
   */
  fleetManaged?: boolean;
  fleet?: { issuer: string; name: string } | null;
  enabled: boolean;
  /** Where the verification keys come from (`none`: can't be enabled). */
  keys?: string;
  /** Display state of the catalog (e.g. `ok`, `error`, `disabled`). */
  status?: string;
  /** Last refresh / verification error (the cached index is served meanwhile). */
  error?: string | null;
  /** The index's `catalog.title` after the first successful refresh. */
  title?: string | null;
  /** Listed apps. */
  apps?: number;
  generatedAt?: string | null;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  /** Git catalogs: the commit the last successful refresh checked out (the ref resolved). */
  resolvedCommit?: string | null;
}

/** `GET /apps/catalogs`. */
export interface AppCatalogsResponse {
  catalogs: AppCatalog[];
  /** `Cluster.spec.appStore.allowedTrust`. */
  allowedTrust: TrustLabel[];
}

/** `GET /apps`: one app of an enabled catalog (taken-down versions hidden by the cluster). */
export interface AppSummary {
  catalog: string;
  name: string;
  title: string;
  summary: string;
  publisher: string;
  /** Effective trust label (official only from the official catalog). */
  trust: TrustLabel;
  /**
   * Whether projects may install it: `allowedTrust` admits its label and the cluster meets `minLoadweaver` (shown
   * either way, install refused).
   */
  installable?: boolean;
  /** Why not: the trust label isn't allowed, or the cluster is older than `minLoadweaver`. */
  notInstallableReason?: 'trust' | 'loadweaver-version' | null;
  /** `minLoadweaver` of the shown version. */
  minLoadweaver?: string | null;
  /** The cluster's Loadweaver version (null: development build, not checked). */
  loadweaverVersion?: string | null;
  deprecated?: boolean;
  latest?: CatalogAppVersion | null;
  versions?: CatalogAppVersion[];
  /** Optional store categories (not sent by the cluster yet; the filter shows when present). */
  categories?: string[];
}

/** `GET /apps/:catalog/:app[?version=]`: the app with one version's verified package (manifest, README). */
export interface AppDetail extends AppSummary {
  versions: CatalogAppVersion[];
  /** The version whose package is shown. */
  version?: CatalogAppVersion;
  manifest: AppManifest;
  readme: string;
  /** State of the catalog (`error`: a refresh failed, the cached index is served). */
  catalogStatus?: string;
}

/** Suggestion groups an install can include (`manifest.suggestions` + `backups` = the manifest's backup policies). */
export type AppSuggestionGroup = 'groups' | 'policies' | 'ingress' | 'dns' | 'backups';

/** `POST /apps/:catalog/:app/:version/plan`. */
export interface AppInstallRequest {
  project: string;
  /** Deployment name (default: the app name). */
  deployment?: string;
  parameters: Record<string, ParameterValue>;
  /** Manifest secret name → secret reference `secret://<project>/<name>[@<version>]`. */
  secrets: Record<string, string>;
  /** Suggestion groups to include (default: all). */
  suggestions?: AppSuggestionGroup[];
  title?: string;
}

/** Answer of the plan routes: the Workspace draft (reviewed and submitted as a plan) and what went into it. */
export interface AppPlanResult {
  action?: 'install' | 'update' | 'uninstall';
  project?: string;
  deployment?: string;
  draft?: { id: string } | null;
  /** Tolerated as well (a direct plan). */
  plan?: { id: string } | null;
  draftId?: string | null;
  planId?: string | null;
  warnings?: string[];
}

/** `metadata.app` of an installed app's `Deployment`. */
export interface InstalledAppRef {
  catalog: string;
  name: string;
  version: string;
  channel: string;
  digest: string;
}

/** `GET /apps/installed`: an app installed as a `Deployment` (the ones the caller may read). */
export interface InstalledApp {
  project: string;
  deployment: string;
  app: InstalledAppRef;
  title?: string | null;
  parameters?: Record<string, unknown>;
  /** Newer listed versions in the installed channel, newest first. */
  updates?: CatalogAppVersion[];
  /** `ok`, `catalog-unavailable` (disabled / no verified index) or `missing` (no longer listed). */
  availability?: 'ok' | 'catalog-unavailable' | 'missing';
  /** The installed version (or the app) was taken down: inbox warning + badge. */
  takedown?: { reason: string; at: string } | null;
}

/**
 * `POST /apps/installed/:project/:deployment/update-plan`: backup first (default: applying the plan backs up the
 * volumes the target's declared backups name, then updates) + the target's migrations.
 */
export interface AppUpdateRequest {
  version: string;
  parameters?: Record<string, ParameterValue>;
  secrets?: Record<string, string>;
  backup?: 'now' | 'skip';
  title?: string;
}

/** What uninstall does with the app's volumes (asked every time; never silent). */
export type AppDataPolicy = 'keep' | 'backup' | 'delete';

export const APP_DATA_POLICIES: readonly AppDataPolicy[] = ['keep', 'backup', 'delete'];

/** `POST …/uninstall-plan`: `delete` also needs `confirm` = the deployment's name. */
export interface AppUninstallRequest {
  dataPolicy: AppDataPolicy;
  confirm?: string;
  removeSuggested?: boolean;
  title?: string;
}

/** `GET /apps` filters. */
export interface AppListQuery {
  q?: string;
  catalog?: string;
  trust?: TrustLabel;
}
