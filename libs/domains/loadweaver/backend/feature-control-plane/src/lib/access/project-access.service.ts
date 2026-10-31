import { getUserFromRequest, UserRole, type RequestWithUser } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { stringify, parse } from 'yaml';
import { z } from 'zod';
import { DataSource, EntityManager } from 'typeorm';

import { ClusterMemberEntity, type ClusterRole } from '../entities/cluster-member.entity';
import {
  APPROVAL_MODES,
  PROJECT_ROLES,
  ProjectMemberEntity,
  ProjectSettingsEntity,
  PolicyAcceptanceEntity,
  type ApprovalMode,
  type ProjectRole,
} from '../entities/project-access.entity';
import { PlanEntity } from '../entities/plan.entity';
import { capRolesToFleetIdentity, fleetIdentityOf } from '../fleet-identity/fleet-identity.utils';
import { emailOf, userEmails } from '../fleet-identity/user-emails';
import { ResourceEntity } from '../entities/resource.entity';
import { AuditLogService, actorFromRequest, type AuditActor } from '../services/audit-log.service';
import { ChangeEventsService } from '../services/change-events.service';
import {
  atLeast,
  canReadProject,
  canReadProjectSensitive,
  mayGrant,
  projectRole,
  type AccessCaller,
} from './access.utils';
import { crossProjectReferences, type CrossProjectReference } from './plan-access.utils';

export interface CrossProjectRequest extends CrossProjectReference {
  /** Pending plan proposing it; null for an applied policy. */
  planId: string | null;
  accepted: boolean;
}

const CLUSTER_ROLES: readonly ClusterRole[] = ['cluster-admin', 'infra-operator', 'auditor'];
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const USER_ID = /^[A-Za-z0-9@._:|-]{1,255}$/;
/** Cluster roles reference platform users (foreign key to `users`). */
const CLUSTER_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Access settings as YAML, for documentation and setup (3.17). */
const accessDocumentSchema = z
  .object({
    clusterMembers: z
      .array(z.object({ userId: z.string().regex(CLUSTER_USER_ID), role: z.enum(CLUSTER_ROLES) }).strict())
      .max(10_000)
      .default([]),
    projects: z
      .array(
        z
          .object({
            name: z.string().regex(NAME),
            approvalMode: z.enum(APPROVAL_MODES).default('developers'),
            developerExec: z.boolean().default(false),
            recordTerminals: z.boolean().default(false),
            members: z
              .array(z.object({ userId: z.string().regex(USER_ID), role: z.enum(PROJECT_ROLES) }).strict())
              .max(10_000)
              .default([]),
          })
          .strict(),
      )
      .max(10_000)
      .default([]),
  })
  .strict();
export type AccessDocument = z.infer<typeof accessDocumentSchema>;

/**
 * A membership with the emails of the member and of who granted it (`null`: deleted user / API key), resolved
 * server-side like Agenstra's workspace members (`userEmail`): whoever may read the member list sees them.
 */
export type ProjectMemberDto = ProjectMemberEntity & { userEmail: string | null; createdByEmail: string | null };
export type ClusterMemberDto = ClusterMemberEntity & { userEmail: string | null; createdByEmail: string | null };

async function withEmails<T extends { userId: string; createdBy: string | null }>(
  manager: Pick<EntityManager, 'getRepository'>,
  rows: T[],
): Promise<(T & { userEmail: string | null; createdByEmail: string | null })[]> {
  const emails = await userEmails(
    manager,
    rows.flatMap((r) => [r.userId, r.createdBy]),
  );

  return rows.map((r) => ({
    ...r,
    userEmail: emailOf(emails, r.userId),
    createdByEmail: emailOf(emails, r.createdBy),
  }));
}

export interface ProjectSettingsDto {
  project: string;
  approvalMode: ApprovalMode;
  developerExec: boolean;
  recordTerminals: boolean;
  createdBy: string | null;
}

/**
 * Project access (3.17): memberships and settings change immediately through the API (never plan / apply, so a stuck
 * plan can't lock anyone out), every change is audited, and every read is filtered by what the caller may see.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditLogService,
    @Optional() private readonly events?: ChangeEventsService,
  ) {}

  /** Every role the caller holds. */
  async caller(req?: RequestWithUser, manager: EntityManager = this.dataSource.manager): Promise<AccessCaller> {
    const info = getUserFromRequest(req || ({} as RequestWithUser));

    if (info.isApiKeyAuth) return { isApiKey: true, clusterRole: 'cluster-admin', projects: new Map() };

    if (!info.userId) return { isApiKey: false, projects: new Map() };

    const isPat = (info.amr ?? []).includes('pat');
    const membership = await manager.getRepository(ClusterMemberEntity).findOne({ where: { userId: info.userId } });
    const projects = await manager.getRepository(ProjectMemberEntity).find({ where: { userId: info.userId } });

    const own: AccessCaller = {
      userId: info.userId,
      isApiKey: false,
      // PAT sessions never inherit admin powers from the JWT role claim.
      clusterRole: info.userRole === UserRole.ADMIN && !isPat ? 'cluster-admin' : membership?.role,
      projects: new Map(projects.map((p) => [p.project, p.role])),
    };
    // A fleet's service user acting for a verified person (3.24): that person, with the fleet grant capped by the
    // service user's own roles.
    const identity = fleetIdentityOf(req);

    return identity ? { ...capRolesToFleetIdentity(own, identity), userId: identity.person, isApiKey: false } : own;
  }

  async assertRead(req: RequestWithUser | undefined, project: string): Promise<AccessCaller> {
    const caller = await this.caller(req);

    if (!canReadProject(caller, project)) throw new NotFoundException('project not found');

    return caller;
  }

  async assertSensitive(req: RequestWithUser | undefined, project: string): Promise<AccessCaller> {
    const caller = await this.caller(req);

    if (!canReadProjectSensitive(caller, project)) throw new NotFoundException('project not found');

    return caller;
  }

  private async projectExists(manager: EntityManager, project: string): Promise<boolean> {
    return !!(await manager.getRepository(ResourceEntity).findOne({ where: { kind: 'Project', name: project } }));
  }

  async projectSettings(req: RequestWithUser | undefined, project: string): Promise<ProjectSettingsDto> {
    await this.assertRead(req, project);

    return await this.settings(this.dataSource.manager, project);
  }

  async settings(manager: EntityManager, project: string): Promise<ProjectSettingsDto> {
    const row = await manager.getRepository(ProjectSettingsEntity).findOne({ where: { project } });

    return {
      project,
      approvalMode: row?.approvalMode ?? 'developers',
      developerExec: row?.developerExec ?? false,
      recordTerminals: row?.recordTerminals ?? false,
      createdBy: row?.createdBy ?? null,
    };
  }

  /** Records the creator of a new project (inside the apply that creates it). */
  async projectCreated(manager: EntityManager, project: string, createdBy: string | null): Promise<void> {
    const repo = manager.getRepository(ProjectSettingsEntity);

    if (!(await repo.findOne({ where: { project } }))) await repo.save(repo.create({ project, createdBy }));
  }

  /** Access rows of a deleted project go with it. */
  async projectDeleted(manager: EntityManager, project: string): Promise<void> {
    await manager.getRepository(ProjectMemberEntity).delete({ project });
    await manager.getRepository(ProjectSettingsEntity).delete({ project });
  }

  async members(req: RequestWithUser | undefined, project: string): Promise<ProjectMemberDto[]> {
    await this.assertRead(req, project);

    const rows = await this.dataSource
      .getRepository(ProjectMemberEntity)
      .find({ where: { project }, order: { createdAt: 'ASC' } });

    return await withEmails(this.dataSource, rows);
  }

  async setMember(
    req: RequestWithUser | undefined,
    project: string,
    userId: string,
    role: ProjectRole | null,
  ): Promise<void> {
    if (!USER_ID.test(userId)) throw new BadRequestException('invalid user id');

    await this.dataSource.transaction(async (manager) => {
      const caller = await this.caller(req, manager);

      if (!(await this.projectExists(manager, project))) throw new NotFoundException('project not found');

      const repo = manager.getRepository(ProjectMemberEntity);
      const current = await repo.findOne({ where: { project, userId } });
      const { createdBy } = await this.settings(manager, project);

      if (!mayGrant(caller, project, createdBy, role, current?.role))
        throw new ForbiddenException(
          role === 'admin' || current?.role === 'admin'
            ? 'only cluster admins and the project creator manage project admins'
            : 'project admin role required',
        );

      if (role) await repo.save(repo.create({ project, userId, role, createdBy: caller.userId ?? 'api-key' }));
      else if (current) await repo.delete({ project, userId });
      else return;

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: role ? 'project.member.set' : 'project.member.remove',
        target: `project/${project}/member/${userId}`,
        project,
        details: { role, previous: current?.role ?? null },
      });
    });

    // Memberships managed in Git are committed back (3.29).
    this.events?.accessChanged({ cluster: false, projects: [project] });
  }

  async updateSettings(
    req: RequestWithUser | undefined,
    project: string,
    patch: { approvalMode?: ApprovalMode; developerExec?: boolean; recordTerminals?: boolean },
  ): Promise<ProjectSettingsDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const caller = await this.caller(req, manager);

      if (!(await this.projectExists(manager, project))) throw new NotFoundException('project not found');

      if (projectRole(caller, project) !== 'admin') throw new ForbiddenException('project admin role required');

      const before = await this.settings(manager, project);
      const after = { ...before, ...patch };

      await manager.getRepository(ProjectSettingsEntity).save({
        project,
        approvalMode: after.approvalMode,
        developerExec: after.developerExec,
        recordTerminals: after.recordTerminals,
        createdBy: before.createdBy,
      });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'project.settings',
        target: `project/${project}`,
        project,
        details: {
          before: {
            approvalMode: before.approvalMode,
            developerExec: before.developerExec,
            recordTerminals: before.recordTerminals,
          },
          after: patch,
        },
      });

      return after;
    });

    this.events?.accessChanged({ cluster: false, projects: [project] });

    return result;
  }

  private async userExists(userId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query('SELECT 1 FROM "users" WHERE "id" = $1', [userId]);

    return rows.length > 0;
  }

  async clusterMembers(req: RequestWithUser | undefined): Promise<ClusterMemberDto[]> {
    const caller = await this.caller(req);

    if (!caller.clusterRole) throw new ForbiddenException('Missing cluster permission');

    const rows = await this.dataSource.getRepository(ClusterMemberEntity).find({ order: { createdAt: 'ASC' } });

    return await withEmails(this.dataSource, rows);
  }

  async setClusterMember(req: RequestWithUser | undefined, userId: string, role: ClusterRole | null): Promise<void> {
    if (!CLUSTER_USER_ID.test(userId)) throw new BadRequestException('invalid user id');

    if (role && !(await this.userExists(userId))) throw new BadRequestException('unknown user');

    await this.dataSource.transaction(async (manager) => {
      const caller = await this.caller(req, manager);

      if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admin role required');

      const repo = manager.getRepository(ClusterMemberEntity);
      const current = await repo.findOne({ where: { userId } });

      if (role) await repo.save(repo.create({ userId, role, createdBy: caller.userId ?? 'api-key' }));
      else if (current) await repo.delete({ userId });
      else return;

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: role ? 'cluster.member.set' : 'cluster.member.remove',
        target: `cluster/member/${userId}`,
        details: { role, previous: current?.role ?? null },
      });
    });

    this.events?.accessChanged({ cluster: true, projects: [] });
  }

  /**
   * Cross-project requests towards a project (3.17): policies of other projects reaching its groups, from pending
   * plans and applied ones, with whether this project accepted exactly that version.
   */
  async requests(req: RequestWithUser | undefined, project: string): Promise<CrossProjectRequest[]> {
    await this.assertRead(req, project);

    const acceptances = await this.dataSource.getRepository(PolicyAcceptanceEntity).find({ where: { peer: project } });
    const accepted = (ref: CrossProjectReference) =>
      acceptances.some((a) => a.project === ref.project && a.policy === ref.policy && a.specHash === ref.specHash);
    const pending = (await this.dataSource.getRepository(PlanEntity).find({ where: { status: 'pending' } })).flatMap(
      (plan) =>
        crossProjectReferences(plan.changes)
          .filter((r) => r.peer === project)
          .map((r) => ({ ...r, planId: plan.id, accepted: accepted(r) })),
    );
    const applied = crossProjectReferences(
      (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Policy' } }))
        .filter((r) => r.project && r.project !== project)
        .map((r) => ({ action: 'create', kind: 'Policy', name: r.name, project: r.project, after: { spec: r.spec } })),
    )
      .filter((r) => r.peer === project)
      .map((r) => ({ ...r, planId: null, accepted: accepted(r) }));

    return [...pending, ...applied];
  }

  /** Accepts another project's policy into this project, bound to its exact spec (operators / admins). */
  async accept(
    req: RequestWithUser | undefined,
    project: string,
    request: { project: string; policy: string; specHash: string },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const caller = await this.caller(req, manager);

      if (!atLeast(projectRole(caller, project), 'operator'))
        throw new ForbiddenException('operator or admin role in the accepting project required');

      const known = (await this.requests(req, project)).some(
        (r) => r.project === request.project && r.policy === request.policy && r.specHash === request.specHash,
      );

      if (!known) throw new NotFoundException('no such request');

      await manager.getRepository(PolicyAcceptanceEntity).save({
        project: request.project,
        policy: request.policy,
        peer: project,
        specHash: request.specHash,
        acceptedBy: caller.userId ?? 'api-key',
      });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'project.policy.accept',
        target: `project/${project}/accept/${request.project}/${request.policy}`,
        project,
        details: { specHash: request.specHash },
      });
    });
  }

  /** Every membership and setting as YAML (cluster admins). */
  async exportAccess(req: RequestWithUser | undefined): Promise<string> {
    const caller = await this.caller(req);

    if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admin role required');

    return stringify(await this.accessDocument({ clusterMembers: true }));
  }

  /**
   * The access document of a scope (also `access.yaml` of a Git connection, 3.29): cluster members if asked for, and
   * the listed projects (all existing ones if no list is given).
   */
  async accessDocument(scope: { clusterMembers: boolean; projects?: readonly string[] }): Promise<AccessDocument> {
    const members = await this.dataSource
      .getRepository(ProjectMemberEntity)
      .find({ order: { project: 'ASC', userId: 'ASC' } });
    const settings = await this.dataSource.getRepository(ProjectSettingsEntity).find();
    const projects = (await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'Project' } }))
      .map((r) => r.name)
      .filter((name) => !scope.projects || scope.projects.includes(name))
      .sort();

    return {
      clusterMembers: scope.clusterMembers
        ? (await this.dataSource.getRepository(ClusterMemberEntity).find({ order: { userId: 'ASC' } })).map((m) => ({
            userId: m.userId,
            role: m.role,
          }))
        : [],
      projects: projects.map((name) => {
        const s = settings.find((x) => x.project === name);

        return {
          name,
          approvalMode: s?.approvalMode ?? 'developers',
          developerExec: s?.developerExec ?? false,
          recordTerminals: s?.recordTerminals ?? false,
          members: members.filter((m) => m.project === name).map((m) => ({ userId: m.userId, role: m.role })),
        };
      }),
    };
  }

  /**
   * Makes access match the document exactly (cluster admins): listed memberships are set, others in the listed
   * projects removed; projects not in the document stay as they are. Cluster members are replaced only when listed.
   */
  async importAccess(req: RequestWithUser | undefined, yaml: string): Promise<{ changed: number }> {
    const document = parseAccessDocument(yaml);

    const result = await this.dataSource.transaction(async (manager) => {
      const caller = await this.caller(req, manager);

      if (caller.clusterRole !== 'cluster-admin') throw new ForbiddenException('cluster admin role required');

      return await this.applyDocument(manager, document, actorFromRequest(req), caller.userId ?? 'api-key', {});
    });

    this.events?.accessChanged({
      cluster: document.clusterMembers.length > 0,
      projects: document.projects.map((p) => p.name),
    });

    return result;
  }

  /**
   * Imports a Git connection's `access.yaml` (3.29, direct-API semantics): a project connection may only list its own
   * project (no cluster members), the cluster connection only the projects it carries.
   */
  async importFromGit(
    yaml: string,
    scope: { project: string | null; projects: readonly string[] },
    actor: AuditActor,
    source: Record<string, unknown>,
  ): Promise<{ changed: number }> {
    const document = parseAccessDocument(yaml);
    const allowed = scope.project !== null ? [scope.project] : scope.projects;

    if (scope.project !== null && document.clusterMembers.length > 0)
      throw new BadRequestException('access.yaml of a project connection cannot list cluster members');

    const outside = document.projects.filter((p) => !allowed.includes(p.name)).map((p) => p.name);

    if (outside.length > 0)
      throw new BadRequestException(`access.yaml lists projects outside this connection: ${outside.join(', ')}`);

    return await this.dataSource.transaction(
      async (manager) => await this.applyDocument(manager, document, actor, 'git', source),
    );
  }

  private async applyDocument(
    manager: EntityManager,
    document: AccessDocument,
    actor: AuditActor,
    grantedBy: string,
    source: Record<string, unknown>,
  ): Promise<{ changed: number }> {
    let changed = 0;
    const clusterRepo = manager.getRepository(ClusterMemberEntity);

    if (document.clusterMembers.length > 0) {
      for (const m of document.clusterMembers)
        if (!(await this.userExists(m.userId))) throw new BadRequestException(`unknown user ${m.userId}`);

      const wanted = new Map(document.clusterMembers.map((m) => [m.userId, m.role]));

      for (const m of await clusterRepo.find())
        if (!wanted.has(m.userId)) {
          await clusterRepo.delete({ userId: m.userId });
          changed++;
        }

      for (const [userId, role] of wanted) {
        const current = await clusterRepo.findOne({ where: { userId } });

        if (current?.role === role) continue;

        await clusterRepo.save(clusterRepo.create({ userId, role, createdBy: grantedBy }));
        changed++;
      }
    }

    const memberRepo = manager.getRepository(ProjectMemberEntity);

    for (const p of document.projects) {
      if (!(await this.projectExists(manager, p.name)))
        throw new BadRequestException(`project ${p.name} does not exist`);

      const before = await this.settings(manager, p.name);

      await manager.getRepository(ProjectSettingsEntity).save({
        project: p.name,
        approvalMode: p.approvalMode,
        developerExec: p.developerExec,
        recordTerminals: p.recordTerminals,
        createdBy: before.createdBy,
      });

      const wanted = new Map(p.members.map((m) => [m.userId, m.role]));

      for (const m of await memberRepo.find({ where: { project: p.name } }))
        if (!wanted.has(m.userId)) {
          await memberRepo.delete({ project: p.name, userId: m.userId });
          changed++;
        }

      for (const [userId, role] of wanted) {
        const current = await memberRepo.findOne({ where: { project: p.name, userId } });

        if (current?.role === role) continue;

        await memberRepo.save(memberRepo.create({ project: p.name, userId, role, createdBy: grantedBy }));
        changed++;
      }
    }

    await this.audit.record(manager, {
      actor,
      action: 'access.import',
      target: 'cluster/access',
      details: { changed, projects: document.projects.map((p) => p.name), ...source },
    });

    return { changed };
  }
}

export function parseAccessDocument(yaml: string): AccessDocument {
  try {
    return accessDocumentSchema.parse(parse(yaml, { maxAliasCount: 0 }) ?? {});
  } catch (error) {
    throw new BadRequestException(`invalid access document: ${error instanceof Error ? error.message : 'unreadable'}`);
  }
}
