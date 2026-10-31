import type { RequestWithUser } from '@forepath/identity/backend';
import { parseResourceDocuments } from '@forepath/loadweaver/shared/util-model';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import type { AccessCaller } from '../access/access.utils';
import { ProjectAccessService } from '../access/project-access.service';
import type { PlanResponseDto } from '../dto/plan.dto';
import { emailOf, userEmails } from '../fleet-identity/user-emails';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { PlansService } from '../services/plans.service';
import { TopologyService, type TopologyResponse } from '../topology/topology.service';
import { DraftEntity, type DraftOp, type DraftStatus } from './draft.entity';
import {
  applyDraftPatch,
  draftActor,
  toDraftResponse,
  type DraftResponseDto,
  draftConflicts,
  draftDocumentBytes,
  draftOpKey,
  draftPlanInput,
  draftScope,
  MAX_DRAFT_DOCUMENT_BYTES,
  MAX_DRAFT_OPS,
  MAX_OPEN_DRAFTS_PER_OWNER,
  mayEditDraft,
  mayPlanScope,
  type DraftConflict,
} from './drafts.utils';

/** One op as a client sends it: an upsert carries the resource document, a delete its reference. */
export interface DraftOpInput {
  op: 'upsert' | 'delete';
  document?: string;
  kind?: string;
  name?: string;
  project?: string;
  /** The generation the client edited; read from the cluster when absent. */
  baseGeneration?: number;
}

export interface DraftPreviewDto {
  version: number;
  plan: PlanResponseDto;
  topology: TopologyResponse;
  conflicts: DraftConflict[];
}

/**
 * Server-side, shared Workspace drafts (3.36): edits collected as ops (upsert a document / delete a reference) with
 * the generation they were based on, edited concurrently under an optimistic `version`, previewed as a dry-run plan
 * with the map overlay, and submitted as an ordinary plan. Every change is audited; `socket/plans` streams them.
 */
@Injectable()
export class DraftsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
    private readonly plans: PlansService,
    private readonly topology: TopologyService,
  ) {}

  async create(
    req: RequestWithUser | undefined,
    input: { title: string; ops?: DraftOpInput[] },
  ): Promise<DraftResponseDto> {
    const caller = await this.access.caller(req);
    const actor = draftActor(req);
    const ops = await this.toOps(caller, input.ops ?? [], actor);

    return await this.dataSource.transaction(async (manager) => {
      const open = await manager.getRepository(DraftEntity).count({ where: { owner: actor, status: 'open' } });

      if (open >= MAX_OPEN_DRAFTS_PER_OWNER)
        throw new BadRequestException(`at most ${MAX_OPEN_DRAFTS_PER_OWNER} open drafts per owner`);

      const repo = manager.getRepository(DraftEntity);
      const draft = await repo.save(
        repo.create({ title: input.title.trim(), owner: actor, ops, ...draftScope(ops), version: 1, status: 'open' }),
      );

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'draft.create',
        target: `draft/${draft.id}`,
        project: draft.projects.length === 1 ? draft.projects[0] : null,
        details: { title: draft.title, ops: ops.map(draftOpKey) },
      });

      return toDraftResponse(draft);
    });
  }

  async list(req: RequestWithUser | undefined, status: DraftStatus = 'open'): Promise<DraftResponseDto[]> {
    const caller = await this.access.caller(req);
    const actor = draftActor(req);
    const drafts = await this.dataSource
      .getRepository(DraftEntity)
      .find({ where: { status }, order: { updatedAt: 'DESC' }, take: 500 });

    const visible = drafts.filter((d) => mayEditDraft(caller, actor, d));
    // Owner emails only for the drafts the caller may see (one batched lookup, D11).
    const emails = await userEmails(
      this.dataSource,
      visible.map((d) => d.owner),
    );

    return visible.map((d) => toDraftResponse(d, emailOf(emails, d.owner)));
  }

  async get(req: RequestWithUser | undefined, id: string): Promise<DraftResponseDto> {
    const draft = await this.visible(req, id);
    const emails = await userEmails(this.dataSource, [draft.owner]);

    return toDraftResponse(draft, emailOf(emails, draft.owner));
  }

  /** Changes title / ops under the caller's `version`; 409 with the current draft when someone else was faster. */
  async patch(
    req: RequestWithUser | undefined,
    id: string,
    input: { version: number; title?: string; set?: DraftOpInput[]; remove?: string[] },
  ): Promise<DraftResponseDto> {
    const caller = await this.access.caller(req);
    const actor = draftActor(req);
    const set = await this.toOps(caller, input.set ?? [], actor);

    return await this.dataSource.transaction(async (manager) => {
      const draft = await this.locked(manager, caller, actor, id, input.version);
      const ops = applyDraftPatch(draft.ops, { set, remove: input.remove });

      this.assertLimits(ops);
      Object.assign(draft, {
        ops,
        ...draftScope(ops),
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        version: draft.version + 1,
      });

      const saved = await manager.getRepository(DraftEntity).save(draft);

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'draft.update',
        target: `draft/${id}`,
        project: saved.projects.length === 1 ? saved.projects[0] : null,
        details: {
          version: saved.version,
          ...(input.title !== undefined ? { title: saved.title } : {}),
          set: set.map(draftOpKey),
          removed: input.remove ?? [],
        },
      });

      return toDraftResponse(saved);
    });
  }

  /** Dry-run plan of the draft with the map overlay and the conflicts (nothing stored, 3.36 B2). */
  async preview(req: RequestWithUser | undefined, id: string): Promise<DraftPreviewDto> {
    const draft = await this.visible(req, id);

    if (draft.status !== 'open') throw new ConflictException(`draft is ${draft.status}`);

    const plan = await this.plans.create({ ...draftPlanInput(draft.ops), dryRun: true }, req);
    const topology = await this.topology.topology(req, {}, plan.changes);

    return {
      version: draft.version,
      plan,
      topology,
      conflicts: draftConflicts(draft.ops, await this.generations(this.dataSource.manager, draft.ops)),
    };
  }

  /**
   * Submits the draft as a plan (approvals, Git PR mode, fleet claims unchanged). Refused with 409 while ops conflict
   * (their base generation moved) — the console rebases them first.
   */
  async submit(req: RequestWithUser | undefined, id: string, version: number): Promise<PlanResponseDto> {
    const caller = await this.access.caller(req);
    const actor = draftActor(req);
    // Claim the draft first, so two submits can't create two plans.
    const claimed = await this.dataSource.transaction(async (manager) => {
      const draft = await this.locked(manager, caller, actor, id, version);

      if (draft.ops.length === 0) throw new BadRequestException('nothing to plan');

      const conflicts = draftConflicts(draft.ops, await this.generations(manager, draft.ops));

      if (conflicts.length > 0) throw new ConflictException({ message: 'draft conflicts with the cluster', conflicts });

      draft.status = 'submitted';
      draft.version += 1;

      return await manager.getRepository(DraftEntity).save(draft);
    });

    let plan: PlanResponseDto;

    try {
      plan = await this.plans.create(draftPlanInput(claimed.ops), req, { draft: { id, title: claimed.title } });
    } catch (error) {
      // Back to open (a new version, so stale editors re-read).
      await this.dataSource
        .getRepository(DraftEntity)
        .update({ id, status: 'submitted' }, { status: 'open', version: claimed.version + 1 });

      throw error;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(DraftEntity).update({ id }, { planId: plan.id });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'draft.submit',
        target: `draft/${id}`,
        project: claimed.projects.length === 1 ? claimed.projects[0] : null,
        details: { plan: plan.id, ops: claimed.ops.length },
      });
    });

    return plan;
  }

  async discard(req: RequestWithUser | undefined, id: string, version: number): Promise<DraftResponseDto> {
    const caller = await this.access.caller(req);
    const actor = draftActor(req);

    return await this.dataSource.transaction(async (manager) => {
      const draft = await this.locked(manager, caller, actor, id, version);

      draft.status = 'discarded';
      draft.version += 1;

      const saved = await manager.getRepository(DraftEntity).save(draft);

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'draft.discard',
        target: `draft/${id}`,
        project: saved.projects.length === 1 ? saved.projects[0] : null,
        details: { owner: saved.owner, ops: saved.ops.length },
      });

      return toDraftResponse(saved);
    });
  }

  /** A draft the caller may see (404 otherwise, so drafts of other projects aren't revealed). */
  private async visible(req: RequestWithUser | undefined, id: string): Promise<DraftEntity> {
    const caller = await this.access.caller(req);
    const draft = await this.dataSource.getRepository(DraftEntity).findOne({ where: { id } });

    if (!draft || !mayEditDraft(caller, draftActor(req), draft)) throw new NotFoundException('draft not found');

    return draft;
  }

  /** The open draft, row-locked, at the caller's version. */
  private async locked(
    manager: EntityManager,
    caller: AccessCaller,
    actor: string,
    id: string,
    version: number,
  ): Promise<DraftEntity> {
    const draft = await manager
      .getRepository(DraftEntity)
      .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });

    if (!draft || !mayEditDraft(caller, actor, draft)) throw new NotFoundException('draft not found');

    if (draft.version !== version)
      throw new ConflictException({ message: 'draft changed', draft: toDraftResponse(draft) });

    if (draft.status !== 'open') throw new ConflictException(`draft is ${draft.status}`);

    return draft;
  }

  /** Validates input ops (one resource per upsert, rights on what they touch) and records their base generation. */
  private async toOps(caller: AccessCaller, inputs: readonly DraftOpInput[], actor: string): Promise<DraftOp[]> {
    const at = new Date().toISOString();
    const parsed = inputs.map((input, index) => {
      if (input.op === 'delete') {
        if (!input.kind || !input.name) throw new BadRequestException(`op ${index}: kind and name required`);

        return { input, ref: { kind: input.kind, name: input.name, project: input.project ?? null } };
      }

      const result = parseResourceDocuments(input.document ?? '');

      if (result.ok === false)
        throw new BadRequestException({ message: `op ${index}: invalid resource`, issues: result.issues });

      if (result.resources.length !== 1) throw new BadRequestException(`op ${index}: exactly one resource per upsert`);

      const [resource] = result.resources;

      return {
        input,
        ref: {
          kind: resource.kind as string,
          name: resource.metadata.name,
          project: resource.metadata.project ?? null,
        },
      };
    });

    if (!mayPlanScope(caller, draftScope(parsed.map((p) => ({ ...p.ref, op: p.input.op })))))
      throw new ForbiddenException('developer role (or the cluster permission) required for every touched resource');

    const current = await this.generations(
      this.dataSource.manager,
      parsed.map((p) => p.ref),
    );
    const ops = parsed.map(
      ({ input, ref }): DraftOp => ({
        op: input.op,
        ...ref,
        ...(input.op === 'upsert' ? { document: input.document } : {}),
        baseGeneration: input.baseGeneration ?? current.get(draftOpKey(ref)) ?? 0,
        by: actor,
        at,
      }),
    );

    this.assertLimits(ops);

    return ops;
  }

  private assertLimits(ops: readonly DraftOp[]): void {
    if (ops.length > MAX_DRAFT_OPS) throw new BadRequestException(`at most ${MAX_DRAFT_OPS} changes per draft`);

    if (draftDocumentBytes(ops) > MAX_DRAFT_DOCUMENT_BYTES)
      throw new BadRequestException(`draft documents exceed ${MAX_DRAFT_DOCUMENT_BYTES} bytes`);
  }

  /** Current generations of the referenced resources, by op key (missing = 0). */
  private async generations(
    manager: EntityManager,
    refs: readonly { kind: string; name: string; project: string | null }[],
  ): Promise<Map<string, number>> {
    if (refs.length === 0) return new Map();

    const rows = (await manager.query(
      `SELECT kind, project, name, generation FROM lw_resources WHERE kind = ANY($1) AND name = ANY($2)`,
      [[...new Set(refs.map((r) => r.kind))], [...new Set(refs.map((r) => r.name))]],
    )) as { kind: string; project: string | null; name: string; generation: number }[];

    return new Map(rows.map((r) => [draftOpKey(r), Number(r.generation)] as const));
  }
}
