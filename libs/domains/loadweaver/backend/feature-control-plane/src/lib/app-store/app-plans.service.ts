import type { RequestWithUser } from '@forepath/identity/backend';
import {
  checkMinLoadweaver,
  compareVersions,
  effectiveTrust,
  findTakedown,
  isTrustAllowed,
  type LintFinding,
  type ManifestMigration,
} from '@forepath/loadweaver/shared/util-app-catalog';
import {
  APP_INSTALL_ANNOTATION,
  installedAppOf,
  type InstalledAppMetadata,
} from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Like } from 'typeorm';

import { atLeast, canReadProject, projectRole, type AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import type { DraftOpInput } from '../drafts/drafts.service';
import { DraftsService } from '../drafts/drafts.service';
import type { DraftResponseDto } from '../drafts/drafts.utils';
import { ResourceEntity } from '../entities/resource.entity';
import { VolumePlacementEntity } from '../entities/volume-placement.entity';
import { VOLUME_DRAFT_KIND } from '../plans/volume-deletions.utils';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { AppCatalogsService, type AppVersionDto } from './app-catalogs.service';
import {
  backupBeforeUpdateVolumes,
  migrationsBetween,
  recordedInputs,
  renderInstall,
  SUGGESTION_GROUPS,
  type SuggestionGroup,
} from './app-plans.utils';

export const UNINSTALL_DATA_POLICIES = ['keep', 'backup', 'delete'] as const;
export type UninstallDataPolicy = (typeof UNINSTALL_DATA_POLICIES)[number];

export interface InstallPlanInput {
  project: string;
  /** Deployment name (default: the app's name). */
  deployment?: string;
  parameters?: Record<string, unknown>;
  /** Manifest secret name → `secret://<project>/<name>[@<version>]`. */
  secrets?: Record<string, string>;
  /** Suggestion groups to include (default: all); each suggested resource is its own draft op. */
  suggestions?: SuggestionGroup[];
  title?: string;
}

export interface UpdatePlanInput {
  version: string;
  /** Changes to the recorded parameters / secret references (the rest is kept). */
  parameters?: Record<string, unknown>;
  secrets?: Record<string, string>;
  /**
   * `now` (default): applying the plan backs up the volumes the manifest's backups name first and applies only once
   * they succeeded (apps without declared backups: no backup); `skip` is recorded in the plan title and audit.
   */
  backup?: 'now' | 'skip';
  title?: string;
}

export interface UninstallPlanInput {
  /**
   * Required — never decided silently. `delete` also needs `confirm` = the deployment's name; the plan then deletes
   * the deployment's volumes once it is applied (backups are kept).
   */
  dataPolicy: UninstallDataPolicy;
  confirm?: string;
  /** Also remove the resources the install suggested (annotated with the installation; default true). */
  removeSuggested?: boolean;
  title?: string;
}

export interface AppPlanOpDto {
  /** A `Volume` delete (`name` = `<deployment>/<volume>`) removes that volume's data once the plan is applied. */
  op: 'upsert' | 'delete';
  kind: string;
  name: string;
  project: string;
  role: 'deployment' | 'suggestion' | 'removal';
  group?: SuggestionGroup;
}

export interface AppPlanBackupDto {
  volume: string;
  /** `planned`: backed up when the plan is applied, before anything changes (updates, uninstall with `backup`). */
  status: 'planned' | 'started' | 'running' | 'failed';
  backup: string | null;
  error?: string;
}

/** Answer of the plan routes: the draft (submit it as a plan in the Workspace) and what went into it. */
export interface AppPlanResponseDto {
  action: 'install' | 'update' | 'uninstall';
  project: string;
  deployment: string;
  app: InstalledAppMetadata;
  /** The previous version (updates). */
  from?: string;
  draft: DraftResponseDto;
  ops: AppPlanOpDto[];
  backups: AppPlanBackupDto[];
  migrations: { version: string; description?: string; steps: { name: string; service: string; phase: string }[] }[];
  findings: LintFinding[];
  warnings: string[];
  /** Uninstall: the decision on the data and the volumes it concerns. */
  dataPolicy?: UninstallDataPolicy;
  volumes?: string[];
}

/** `GET /apps/installed`: an installed app with available updates and takedown state. */
export interface InstalledAppDto {
  project: string;
  deployment: string;
  app: InstalledAppMetadata;
  title: string | null;
  parameters: Record<string, unknown>;
  /** Newer listed versions in the installed channel, newest first. */
  updates: AppVersionDto[];
  /** The catalog's state for this app: `ok`, `catalog-unavailable` (disabled / no verified index), `missing` (not listed). */
  availability: 'ok' | 'catalog-unavailable' | 'missing';
  takedown: { reason: string; at: string } | null;
}

function draftTitle(text: string): string {
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/**
 * App store plans (P1): install / update / uninstall become Workspace drafts (3.36) of ordinary resources — the
 * Deployment with its app record plus the suggested groups, policies, ingress, DNS and backup policies as separate
 * ops — that the user reviews, trims and submits as a plan. Same rights as drafting those resources (developer of
 * the project). An update's backup and an uninstall's final backup run when the plan is applied, before anything
 * changes (planning starts nothing); `minLoadweaver` refuses clusters that are too old.
 */
@Injectable()
export class AppPlansService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly catalogs: AppCatalogsService,
    private readonly drafts: DraftsService,
    private readonly audit: AuditLogService,
  ) {}

  private async assertDeveloper(req: RequestWithUser | undefined, project: string): Promise<AccessCaller> {
    const caller = await this.access.caller(req);

    if (!atLeast(projectRole(caller, project), 'developer'))
      throw new ForbiddenException(`installing, updating and removing apps in ${project} needs the developer role`);

    return caller;
  }

  // ---------------------------------------------------------------------------------------------- install

  async installPlan(
    req: RequestWithUser | undefined,
    catalogName: string,
    appName: string,
    version: string,
    input: InstallPlanInput,
  ): Promise<AppPlanResponseDto> {
    await this.assertDeveloper(req, input.project);

    const deployment = input.deployment ?? appName;
    const { config, catalogs } = await this.catalogs.resolve();
    const catalog = this.catalogs.enabled(catalogs, catalogName);
    const app = catalog.index.apps.find((a) => a.name === appName);
    const entry = app?.versions.find((v) => v.version === version);

    if (!app || !entry) throw new NotFoundException(`${appName} ${version} is not in catalog ${catalogName}`);

    const takedown = findTakedown(catalog.index, appName, version);

    if (takedown) throw new GoneException(`${appName} ${version} was taken down: ${takedown.reason}`);

    const trust = effectiveTrust(app, catalog.source);

    if (!isTrustAllowed(trust, config))
      throw new ForbiddenException(
        `the cluster doesn't allow installing ${trust} apps (Cluster.spec.appStore.allowedTrust)`,
      );

    const existing = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Deployment', projectKey: input.project, name: deployment } });

    if (existing) throw new ConflictException(`deployment ${input.project}/${deployment} exists already`);

    const loadweaverVersion = this.catalogs.loadweaverVersion();

    this.assertMinLoadweaver(appName, version, entry.minLoadweaver, loadweaverVersion);

    const pkg = await this.catalogs.package(catalog, appName, version);
    const versionCheck = this.assertMinLoadweaver(appName, version, pkg.manifest.minLoadweaver, loadweaverVersion);
    const record: InstalledAppMetadata = {
      catalog: catalogName,
      name: appName,
      version,
      channel: entry.channel,
      digest: entry.digest,
    };
    const rendered = renderInstall({
      manifest: pkg.manifest,
      compose: pkg.files.compose,
      app: record,
      project: input.project,
      deployment,
      parameters: input.parameters,
      secrets: input.secrets,
      include: input.suggestions ?? SUGGESTION_GROUPS,
    });

    if (rendered.ok === false)
      throw new UnprocessableEntityException({
        message: `${appName} ${version} can't be installed`,
        errors: rendered.errors,
        findings: rendered.findings ?? [],
      });

    const warnings = [...rendered.value.warnings, ...(versionCheck ? [versionCheck] : [])];
    const present = await this.existingKeys(
      input.project,
      rendered.value.suggestions.map((s) => ({ kind: s.kind, name: s.name })),
    );
    const suggestions = rendered.value.suggestions.filter((s) => {
      if (!present.has(`${s.kind}/${s.name}`)) return true;

      warnings.push(`${s.kind} ${input.project}/${s.name} exists already and is left as it is`);

      return false;
    });
    const ops: DraftOpInput[] = [
      { op: 'upsert', document: rendered.value.deployment },
      ...suggestions.map((s) => ({ op: 'upsert' as const, document: s.document })),
    ];
    const draft = await this.drafts.create(req, {
      title: draftTitle(input.title ?? `Install ${pkg.manifest.title} ${version} as ${input.project}/${deployment}`),
      ops,
    });

    await this.record(req, 'app.install-plan', input.project, deployment, { ...record, draft: draft.id });

    return {
      action: 'install',
      project: input.project,
      deployment,
      app: record,
      draft,
      ops: [
        { op: 'upsert', kind: 'Deployment', name: deployment, project: input.project, role: 'deployment' },
        ...suggestions.map((s) => ({
          op: 'upsert' as const,
          kind: s.kind,
          name: s.name,
          project: input.project,
          role: 'suggestion' as const,
          group: s.group,
        })),
      ],
      backups: [],
      migrations: [],
      findings: rendered.value.findings,
      warnings,
    };
  }

  // ----------------------------------------------------------------------------------------------- update

  async updatePlan(
    req: RequestWithUser | undefined,
    project: string,
    deployment: string,
    input: UpdatePlanInput,
  ): Promise<AppPlanResponseDto> {
    await this.assertDeveloper(req, project);

    const row = await this.installed(project, deployment);
    const current = installedAppOf(row.annotations) as InstalledAppMetadata;
    const { config, catalogs } = await this.catalogs.resolve();
    const catalog = this.catalogs.enabled(catalogs, current.catalog);
    const app = catalog.index.apps.find((a) => a.name === current.name);
    const entry = app?.versions.find((v) => v.version === input.version);

    if (!app || !entry)
      throw new NotFoundException(`${current.name} ${input.version} is not in catalog ${current.catalog}`);

    const takedown = findTakedown(catalog.index, current.name, input.version);

    if (takedown) throw new GoneException(`${current.name} ${input.version} was taken down: ${takedown.reason}`);

    if (compareVersions(input.version, current.version) <= 0)
      throw new BadRequestException(
        `${input.version} is not newer than the installed ${current.version} (roll back through the plan history)`,
      );

    const trust = effectiveTrust(app, catalog.source);

    if (!isTrustAllowed(trust, config))
      throw new ForbiddenException(
        `the cluster doesn't allow installing ${trust} apps (Cluster.spec.appStore.allowedTrust)`,
      );

    const loadweaverVersion = this.catalogs.loadweaverVersion();

    this.assertMinLoadweaver(current.name, input.version, entry.minLoadweaver, loadweaverVersion);

    const pkg = await this.catalogs.package(catalog, current.name, input.version);
    const versionCheck = this.assertMinLoadweaver(
      current.name,
      input.version,
      pkg.manifest.minLoadweaver,
      loadweaverVersion,
    );
    const recorded = recordedInputs(row.annotations);
    const declared = new Set(Object.keys(pkg.manifest.parameters.properties));
    const declaredSecrets = new Set(pkg.manifest.secrets.map((s) => s.name));
    const parameters = {
      ...Object.fromEntries(Object.entries(recorded.parameters).filter(([k]) => declared.has(k))),
      ...(input.parameters ?? {}),
    };
    const secrets = {
      ...Object.fromEntries(Object.entries(recorded.secrets).filter(([k]) => declaredSecrets.has(k))),
      ...(input.secrets ?? {}),
    };
    const migrations: ManifestMigration[] = migrationsBetween(pkg.manifest, current.version, input.version);
    const record: InstalledAppMetadata = {
      catalog: current.catalog,
      name: current.name,
      version: input.version,
      channel: entry.channel,
      digest: entry.digest,
    };
    const spec = row.spec as { variables?: Record<string, string> };
    // Backup first (decided P1): the volumes the target manifest's backups name, backed up when the plan is applied.
    const backupMode = input.backup ?? 'now';
    const volumes = await this.deploymentVolumes(project, deployment);
    const backupVolumes =
      backupMode === 'now'
        ? backupBeforeUpdateVolumes(
            pkg.manifest,
            volumes.map((v) => v.slice(`${project}/${deployment}/`.length)),
          )
        : [];
    const rendered = renderInstall({
      manifest: pkg.manifest,
      compose: pkg.files.compose,
      app: record,
      project,
      deployment,
      parameters,
      secrets,
      include: [],
      labels: row.labels,
      variables: spec.variables,
      annotations: row.annotations,
      migrations,
      ...(backupVolumes.length ? { backupBeforeUpdate: { version: input.version, volumes: backupVolumes } } : {}),
    });

    if (rendered.ok === false)
      throw new UnprocessableEntityException({
        message: `${current.name} can't be updated to ${input.version}`,
        errors: rendered.errors,
        findings: rendered.findings ?? [],
      });

    // Volumes that exist now are listed; a bundled dependency switched off has none (nothing to back up).
    const backups: AppPlanBackupDto[] = backupVolumes
      .map((v) => `${project}/${deployment}/${v}`)
      .filter((id) => volumes.includes(id))
      .map((id) => ({ volume: id, status: 'planned' as const, backup: null }));

    const draft = await this.drafts.create(req, {
      title: draftTitle(
        input.title ??
          `Update ${pkg.manifest.title} ${current.version} → ${input.version} in ${project}/${deployment}` +
            (backupMode === 'skip'
              ? ' (no backup first)'
              : backupVolumes.length
                ? ` (backs up ${backupVolumes.length} volume(s) first)`
                : ''),
      ),
      ops: [{ op: 'upsert', document: rendered.value.deployment, baseGeneration: row.generation }],
    });

    await this.record(req, 'app.update-plan', project, deployment, {
      ...record,
      from: current.version,
      draft: draft.id,
      backup: backupMode,
      backupVolumes,
    });

    return {
      action: 'update',
      project,
      deployment,
      app: record,
      from: current.version,
      draft,
      ops: [{ op: 'upsert', kind: 'Deployment', name: deployment, project, role: 'deployment' }],
      backups,
      migrations: migrations.map((m) => ({
        version: m.version,
        ...(m.description ? { description: m.description } : {}),
        steps: m.steps.map((s) => ({ name: s.name, service: s.service, phase: s.phase })),
      })),
      findings: rendered.value.findings,
      warnings: [
        ...rendered.value.warnings,
        ...(versionCheck ? [versionCheck] : []),
        ...(backupMode === 'skip' ? ['no backup is taken before this update (backup: skip)'] : []),
        ...(backupVolumes.length
          ? [
              `applying the plan backs up ${backupVolumes.join(', ')} first and applies the update only once the backups succeeded; a failed backup fails the plan and nothing is applied`,
            ]
          : backupMode === 'now'
            ? ['the app declares no backups: the update is applied without a backup first']
            : []),
        ...(migrations.length
          ? ['migration steps run as one-off jobs once per apply of the deployment (until the next update)']
          : []),
      ],
    };
  }

  // -------------------------------------------------------------------------------------------- uninstall

  async uninstallPlan(
    req: RequestWithUser | undefined,
    project: string,
    deployment: string,
    input: UninstallPlanInput,
  ): Promise<AppPlanResponseDto> {
    await this.assertDeveloper(req, project);

    if (!(UNINSTALL_DATA_POLICIES as readonly string[]).includes(input.dataPolicy))
      throw new BadRequestException('dataPolicy is required: keep, backup or delete');

    if (input.dataPolicy === 'delete' && input.confirm !== deployment)
      throw new BadRequestException(`deleting the data needs confirm: "${deployment}"`);

    const row = await this.installed(project, deployment);
    const app = installedAppOf(row.annotations) as InstalledAppMetadata;
    const volumes = await this.deploymentVolumes(project, deployment);
    // backup: the final backups run when the plan is applied, before the app is removed (planning starts nothing).
    const backups: AppPlanBackupDto[] =
      input.dataPolicy === 'backup' ? volumes.map((id) => ({ volume: id, status: 'planned', backup: null })) : [];
    const backupFirst = backups.map((b) => b.volume.slice(`${project}/${deployment}/`.length));

    const suggested =
      input.removeSuggested === false
        ? []
        : (await this.dataSource.getRepository(ResourceEntity).find({ where: { projectKey: project } })).filter(
            (r) => r.kind !== 'Deployment' && r.annotations?.[APP_INSTALL_ANNOTATION] === deployment,
          );
    // delete: the volumes go with the deployment in the same plan, once it is applied (shown as volume deletions).
    const volumeOps = input.dataPolicy === 'delete' ? volumes.map((id) => id.slice(`${project}/`.length)) : [];
    const ops: DraftOpInput[] = [
      { op: 'delete', kind: 'Deployment', name: deployment, project, ...(backupFirst.length ? { backupFirst } : {}) },
      ...suggested.map((r) => ({ op: 'delete' as const, kind: r.kind, name: r.name, project })),
      ...volumeOps.map((name) => ({ op: 'delete' as const, kind: VOLUME_DRAFT_KIND, name, project })),
    ];
    const dataText = {
      keep: 'volumes kept',
      backup: `final backup of ${volumes.length} volume(s) first, volumes kept`,
      delete: `deletes ${volumes.length} volume(s)`,
    }[input.dataPolicy];
    const draft = await this.drafts.create(req, {
      title: draftTitle(input.title ?? `Uninstall ${app.name} from ${project}/${deployment} (${dataText})`),
      ops,
    });

    await this.record(req, 'app.uninstall-plan', project, deployment, {
      ...app,
      draft: draft.id,
      dataPolicy: input.dataPolicy,
      volumes,
      backupFirst: backups.map((b) => b.volume),
    });

    return {
      action: 'uninstall',
      project,
      deployment,
      app,
      draft,
      ops: [
        { op: 'delete', kind: 'Deployment', name: deployment, project, role: 'removal' },
        ...suggested.map((r) => ({
          op: 'delete' as const,
          kind: r.kind,
          name: r.name,
          project,
          role: 'removal' as const,
        })),
        ...volumeOps.map((name) => ({
          op: 'delete' as const,
          kind: VOLUME_DRAFT_KIND,
          name,
          project,
          role: 'removal' as const,
        })),
      ],
      backups,
      migrations: [],
      findings: [],
      warnings: [
        input.dataPolicy === 'delete'
          ? `the volumes (${volumes.join(', ') || 'none'}) and their data are deleted once the plan is applied (the apply needs confirm); backups are kept and follow their retention`
          : `the volumes (${volumes.join(', ') || 'none'}) stay after the plan is applied (an install under the same deployment name uses them again)`,
        ...(backups.length
          ? [
              `applying the plan backs up ${backups.map((b) => b.volume).join(', ')} first and removes the app only once the backups succeeded; a failed backup fails the plan and nothing is removed`,
            ]
          : input.dataPolicy === 'backup'
            ? ['the app has no volumes: nothing to back up']
            : []),
      ],
      dataPolicy: input.dataPolicy,
      volumes,
    };
  }

  // ------------------------------------------------------------------------------------------- installed

  async installedApps(req: RequestWithUser | undefined, project?: string): Promise<{ apps: InstalledAppDto[] }> {
    const caller = await this.access.caller(req);
    const [installs, flags, { catalogs }] = await Promise.all([
      this.catalogs.installs(),
      this.catalogs.flags(),
      this.catalogs.resolve(),
    ]);
    const flagOf = new Map(flags.map((f) => [`${f.project}/${f.deployment}`, f] as const));

    return {
      apps: installs
        .filter((i) => (!project || i.project === project) && canReadProject(caller, i.project))
        .map((install): InstalledAppDto => {
          const catalog = catalogs.find((c) => c.source.name === install.catalog);
          const index = catalog?.index ?? null;
          const listed = index
            ? index.apps
                .find((a) => a.name === install.name)
                ?.versions.filter((v) => !findTakedown(index, install.name, v.version))
            : undefined;
          const flag = flagOf.get(`${install.project}/${install.deployment}`);
          const app: InstalledAppMetadata = {
            catalog: install.catalog,
            name: install.name,
            version: install.version,
            channel: install.channel,
            digest: install.digest,
          };

          return {
            project: install.project,
            deployment: install.deployment,
            app,
            title: index?.apps.find((a) => a.name === install.name)?.title ?? null,
            parameters: recordedInputs(install.annotations).parameters,
            updates: (listed ?? [])
              .filter((v) => v.channel === install.channel && compareVersions(v.version, install.version) > 0)
              .sort((a, b) => compareVersions(b.version, a.version))
              .map((v) => ({ version: v.version, channel: v.channel, digest: v.digest, published: v.published })),
            availability: !index ? 'catalog-unavailable' : listed?.length ? 'ok' : 'missing',
            takedown: flag ? { reason: flag.reason, at: new Date(flag.takenDownAt).toISOString() } : null,
          };
        })
        .sort((a, b) => a.project.localeCompare(b.project) || a.deployment.localeCompare(b.deployment)),
    };
  }

  // --------------------------------------------------------------------------------------------- helpers

  private async installed(project: string, deployment: string): Promise<ResourceEntity> {
    const row = await this.dataSource
      .getRepository(ResourceEntity)
      .findOne({ where: { kind: 'Deployment', projectKey: project, name: deployment } });

    if (!row) throw new NotFoundException(`deployment ${project}/${deployment} not found`);

    if (!installedAppOf(row.annotations))
      throw new BadRequestException(`deployment ${project}/${deployment} was not installed from the app store`);

    return row;
  }

  private async existingKeys(project: string, refs: readonly { kind: string; name: string }[]): Promise<Set<string>> {
    if (refs.length === 0) return new Set();

    const rows = await this.dataSource.getRepository(ResourceEntity).find({ where: { projectKey: project } });

    return new Set(rows.map((r) => `${r.kind}/${r.name}`).filter((k) => refs.some((r) => `${r.kind}/${r.name}` === k)));
  }

  /**
   * Refuses an install / update the cluster is too old for (`minLoadweaver`); returns the warning for an unknown
   * (development) control-plane version, which isn't checked.
   */
  private assertMinLoadweaver(
    app: string,
    version: string,
    minLoadweaver: string | undefined,
    loadweaverVersion: string | null,
  ): string | null {
    const check = checkMinLoadweaver(minLoadweaver, loadweaverVersion);

    if (check.ok === false) throw new BadRequestException(`${app} ${version} ${check.reason}`);

    return check.warning ?? null;
  }

  /** The volume ids (`<project>/<deployment>/<volume>`) of a deployment, sorted. */
  private async deploymentVolumes(project: string, deployment: string): Promise<string[]> {
    return (
      await this.dataSource
        .getRepository(VolumePlacementEntity)
        .find({ where: { id: Like(`${project}/${deployment}/%`) }, order: { id: 'ASC' } })
    ).map((v) => v.id);
  }

  private async record(
    req: RequestWithUser | undefined,
    action: string,
    project: string,
    deployment: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action,
        target: `deployment/${project}/${deployment}`,
        project,
        details,
      });
    });
  }
}
