import { INITIATIVE_LIMITS } from '@forepath/agenstra/shared/util-initiative-method';
import {
  ClientUsersRepository,
  ensureClientAccess,
  getAuthenticationMethod,
  getUserFromRequest,
  UsersRepository,
  type RequestWithUser,
} from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import type { CreateInitiativeDto, StartIterationDto, UpdateInitiativeDto } from '../dto/initiatives';
import type {
  InitiativeActivityResponseDto,
  InitiativeListResponseDto,
  InitiativeResponseDto,
} from '../dto/initiatives/initiative-response.dto';
import { InitiativeActivityEntity } from '../entities/initiative-activity.entity';
import { InitiativeActionType, InitiativeActorType } from '../entities/initiative.enums';
import { InitiativeEntity } from '../entities/initiative.entity';
import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';
import { ClientsRepository } from '../repositories/clients.repository';
import {
  assertAgentContentWriterWorkspace,
  isAgentContentWriter,
  principalUserId,
  type ContentPrincipal,
} from '../utils/agent-content-writer.utils';
import { initiativeActivityToDto, initiativeEntityToDto } from '../utils/initiative-mappers';

import { INITIATIVES_BOARD_EVENTS } from './initiative-board-realtime.constants';
import { InitiativeBoardRealtimeService } from './initiative-board-realtime.service';
import { afterCommit, registerInitiativeAfterCommitSubscriber } from './initiative-after-commit';

/** Who did something (activity, versions, findings). */
export interface InitiativeActor {
  actorType: InitiativeActorType;
  actorUserId: string | null;
  agentId: string | null;
  /** Extra activity payload (agent attribution). */
  attribution: Record<string, string>;
}

export const INITIATIVE_SYSTEM_ACTOR: InitiativeActor = {
  actorType: InitiativeActorType.SYSTEM,
  actorUserId: null,
  agentId: null,
  attribution: {},
};

/** `%` / `_` / `\` in user input match literally in ILIKE. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Initiatives of a workspace: access (same rule as tickets and knowledge: global admin, workspace creator, workspace
 * members; agents only their own workspace), conditional writes, activity and realtime / webhook emission.
 */
@Injectable()
export class InitiativesService implements OnModuleInit {
  private readonly logger = new Logger(InitiativesService.name);

  constructor(
    @InjectRepository(InitiativeEntity)
    private readonly initiativeRepo: Repository<InitiativeEntity>,
    @InjectRepository(InitiativeActivityEntity)
    private readonly activityRepo: Repository<InitiativeActivityEntity>,
    private readonly clientsRepository: ClientsRepository,
    private readonly clientUsersRepository: ClientUsersRepository,
    private readonly usersRepository: UsersRepository,
    private readonly realtime: InitiativeBoardRealtimeService,
    @Optional() private readonly notificationPublisher?: AgenstraNotificationPublisher,
  ) {}

  onModuleInit(): void {
    // Live board events of transactional writes are sent after COMMIT (see `afterCommit`).
    registerInitiativeAfterCommitSubscriber(this.initiativeRepo.manager?.connection);
  }

  // --- access ---------------------------------------------------------------------------------------------------

  async assertClientAccess(clientId: string, principal?: ContentPrincipal): Promise<void> {
    if (isAgentContentWriter(principal)) {
      assertAgentContentWriterWorkspace(principal, clientId);

      return;
    }

    await ensureClientAccess(this.clientsRepository, this.clientUsersRepository, clientId, principal);
  }

  /** Initiative readable by the principal (404 when missing, 403 without workspace access). */
  async getEntityForPrincipal(id: string, principal?: ContentPrincipal): Promise<InitiativeEntity> {
    const row = await this.initiativeRepo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Initiative not found');
    }

    await this.assertClientAccess(row.clientId, principal);

    return row;
  }

  async getEntityOrThrow(id: string): Promise<InitiativeEntity> {
    const row = await this.initiativeRepo.findOne({ where: { id } });

    if (!row) {
      throw new NotFoundException('Initiative not found');
    }

    return row;
  }

  async findByShaInClient(clientId: string, sha: string): Promise<InitiativeEntity | null> {
    return await this.initiativeRepo.findOne({ where: { clientId, longSha: sha.toLowerCase() } });
  }

  actorOf(principal?: ContentPrincipal): InitiativeActor {
    if (isAgentContentWriter(principal)) {
      return {
        actorType: InitiativeActorType.AI,
        actorUserId: null,
        agentId: principal.agentId,
        attribution: { agentId: principal.agentId, via: principal.source },
      };
    }

    const info = getUserFromRequest(principal || ({} as RequestWithUser));

    if (info.isApiKeyAuth || getAuthenticationMethod() === 'api-key') {
      return INITIATIVE_SYSTEM_ACTOR;
    }

    return info.userId
      ? { actorType: InitiativeActorType.HUMAN, actorUserId: info.userId, agentId: null, attribution: {} }
      : INITIATIVE_SYSTEM_ACTOR;
  }

  /** Decisions only humans (or the admin API key) may take: accepting results, proposals, decisions. */
  assertHuman(principal?: ContentPrincipal): void {
    if (isAgentContentWriter(principal)) {
      throw new NotFoundException('Not found in this workspace');
    }
  }

  // --- CRUD -------------------------------------------------------------------------------------------------------

  async list(
    clientId: string,
    options: { search?: string; state?: string; limit?: number; offset?: number },
    req?: RequestWithUser,
  ): Promise<InitiativeListResponseDto> {
    await this.assertClientAccess(clientId, req);

    const limit = Math.min(
      Math.max(options.limit ?? INITIATIVE_LIMITS.listDefaultLimit, 1),
      INITIATIVE_LIMITS.listMaxLimit,
    );
    const offset = Math.max(options.offset ?? 0, 0);
    const query = this.initiativeRepo
      .createQueryBuilder('i')
      .where('i.client_id = :clientId', { clientId })
      .orderBy('i.updated_at', 'DESC')
      .take(limit)
      .skip(offset);
    const search = options.search?.trim().slice(0, 200);

    if (search) {
      query.andWhere("(i.title ILIKE :search ESCAPE '\\' OR i.long_sha LIKE :sha)", {
        search: `%${escapeLikePattern(search)}%`,
        sha: `${search.toLowerCase().replace(/[^0-9a-f]/g, '')}%`,
      });
    }

    if (options.state) {
      query.andWhere('i.state = :state', { state: options.state });
    }

    const [rows, total] = await query.getManyAndCount();

    return { items: rows.map(initiativeEntityToDto), total };
  }

  async get(id: string, req?: RequestWithUser): Promise<InitiativeResponseDto> {
    return initiativeEntityToDto(await this.getEntityForPrincipal(id, req));
  }

  async create(dto: CreateInitiativeDto, req?: RequestWithUser): Promise<InitiativeResponseDto> {
    await this.assertClientAccess(dto.clientId, req);

    const actor = this.actorOf(req);
    const intent = dto.intent?.trim() ?? '';
    const saved = await this.initiativeRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(InitiativeEntity);
      const row = await repo.save(
        repo.create({
          clientId: dto.clientId,
          title: dto.title.trim(),
          intent,
          path: dto.path,
          phase: intent ? 'plan' : 'clarify',
          state: 'active',
          iteration: 1,
          prerequisiteSatisfiedAt: 'done',
          autoRelease: false,
          version: 1,
          createdByUserId: actor.actorUserId,
        }),
      );

      row.longSha = InitiativeEntity.deriveLongSha(row.id);
      await repo.update(row.id, { longSha: row.longSha });
      await this.appendActivity(row.id, InitiativeActionType.CREATED, actor, { title: row.title, path: row.path }, em);

      return row;
    });

    this.emitInitiative(saved);
    this.notificationPublisher?.publishInitiative(
      'initiative.created',
      saved.clientId,
      this.notificationPayload(saved),
    );

    return initiativeEntityToDto(saved);
  }

  async update(id: string, dto: UpdateInitiativeDto, req?: RequestWithUser): Promise<InitiativeResponseDto> {
    const row = await this.getEntityForPrincipal(id, req);
    const patch: Partial<InitiativeEntity> = {};
    const fields: string[] = [];
    const set = <K extends keyof InitiativeEntity>(key: K, value: InitiativeEntity[K] | undefined) => {
      if (value !== undefined && value !== row[key]) {
        patch[key] = value;
        fields.push(key as string);
      }
    };

    set('title', dto.title?.trim());
    set('intent', dto.intent);
    set('path', dto.path);
    set('phase', dto.phase);
    set('state', dto.state);
    set('prerequisiteSatisfiedAt', dto.prerequisiteSatisfiedAt);
    set('autoRelease', dto.autoRelease);
    set('defaultModel', dto.defaultModel === undefined ? undefined : dto.defaultModel?.trim() || null);

    if (dto.defaultAgentId !== undefined) {
      set('defaultAgentId', dto.defaultAgentId || null);
    }

    if (fields.length === 0) {
      if (dto.expectedVersion !== row.version) {
        throw new ConflictException('The initiative changed meanwhile; load the latest version.');
      }

      return initiativeEntityToDto(row);
    }

    const updated = await this.initiativeRepo.manager.transaction(async (em) => {
      const next = await this.bumpVersion(id, dto.expectedVersion, em, patch);

      await this.appendActivity(id, InitiativeActionType.UPDATED, this.actorOf(req), { fields }, em);

      return next;
    });

    this.emitInitiative(updated);
    this.notificationPublisher?.publishInitiative('initiative.updated', updated.clientId, {
      ...this.notificationPayload(updated),
      fields,
    });

    return initiativeEntityToDto(updated);
  }

  /** Learn & adjust: open the next iteration explicitly (accepted proposals can do it too). */
  async startIteration(id: string, dto: StartIterationDto, req?: RequestWithUser): Promise<InitiativeResponseDto> {
    const row = await this.getEntityForPrincipal(id, req);
    const updated = await this.initiativeRepo.manager.transaction(async (em) => {
      const next = await this.bumpVersion(id, dto.expectedVersion, em, { iteration: row.iteration + 1, phase: 'plan' });

      await this.appendActivity(
        id,
        InitiativeActionType.ITERATION_STARTED,
        this.actorOf(req),
        { iteration: next.iteration },
        em,
      );

      return next;
    });

    this.emitInitiative(updated);

    return initiativeEntityToDto(updated);
  }

  async remove(id: string, req?: RequestWithUser): Promise<void> {
    const row = await this.getEntityForPrincipal(id, req);

    // Cascades to documents, work items, runs, proposals, findings, decisions and activity; tickets are kept.
    await this.initiativeRepo.delete({ id: row.id });
    this.realtime.emitToClient(row.clientId, INITIATIVES_BOARD_EVENTS.initiativeRemoved, {
      id: row.id,
      clientId: row.clientId,
    });
    this.notificationPublisher?.publishInitiative('initiative.deleted', row.clientId, this.notificationPayload(row));
  }

  // --- versions / activity / emission -------------------------------------------------------------------------------

  /**
   * Row lock on the initiative for the rest of the transaction: serializes writes that allocate from current state
   * (work item keys, the one-active-run rule) across concurrent users and replicas. `NO KEY UPDATE` (the lock of
   * `bumpVersion`'s UPDATE) does not conflict with the `KEY SHARE` locks that inserts into child tables take, so it
   * cannot deadlock against a transaction that inserts an activity row and then bumps the version.
   */
  async lockInitiative(em: EntityManager, id: string): Promise<void> {
    await em.query('SELECT "id" FROM "initiatives" WHERE "id" = $1 FOR NO KEY UPDATE', [id]);
  }

  /** Transaction-scoped advisory lock per workspace (the per-workspace active run limit spans initiatives). */
  async lockWorkspaceRuns(em: EntityManager, clientId: string): Promise<void> {
    await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`initiative-runs:${clientId}`]);
  }

  /**
   * Conditional version bump (optionally with field changes): serializes tree edits (reorder, dependencies, accepted
   * results) of concurrent users. `expected` undefined skips the check (system / already-serialized paths).
   */
  async bumpVersion(
    id: string,
    expected: number | undefined,
    em: EntityManager = this.initiativeRepo.manager,
    patch: Partial<InitiativeEntity> = {},
  ): Promise<InitiativeEntity> {
    const query = em
      .createQueryBuilder()
      .update(InitiativeEntity)
      .set({ ...patch, version: () => 'version + 1', updatedAt: () => 'now()' })
      .where('id = :id', { id });

    if (expected !== undefined) {
      query.andWhere('version = :expected', { expected });
    }

    const result = await query.execute();

    if (!result.affected) {
      throw new ConflictException('The initiative changed meanwhile; load the latest version.');
    }

    return (await em.getRepository(InitiativeEntity).findOne({ where: { id } })) as InitiativeEntity;
  }

  async appendActivity(
    initiativeId: string,
    actionType: InitiativeActionType,
    actor: InitiativeActor,
    payload: Record<string, unknown> = {},
    em: EntityManager = this.activityRepo.manager,
  ): Promise<InitiativeActivityEntity> {
    const repo = em.getRepository(InitiativeActivityEntity);
    const row = await repo.save(
      repo.create({
        initiativeId,
        actorType: actor.actorType,
        actorUserId: actor.actorUserId,
        agentId: actor.agentId,
        actionType,
        payload: { ...payload, ...actor.attribution },
      }),
    );
    const clientId = (
      await em.getRepository(InitiativeEntity).findOne({ where: { id: initiativeId }, select: ['id', 'clientId'] })
    )?.clientId;

    if (clientId) {
      // Same shape as the REST list (actor e-mail resolved), or live rows would show the user id until a reload.
      const actorEmail = row.actorUserId
        ? ((await this.usersRepository.findById(row.actorUserId).catch(() => null))?.email ?? null)
        : null;

      // Live boards only learn about the row once the caller's transaction committed.
      afterCommit(em, () =>
        this.realtime.emitToClient(
          clientId,
          INITIATIVES_BOARD_EVENTS.initiativeActivityCreated,
          initiativeActivityToDto(row, actorEmail),
        ),
      );
    }

    return row;
  }

  async listActivity(
    id: string,
    limit: number,
    offset: number,
    req?: RequestWithUser,
  ): Promise<InitiativeActivityResponseDto[]> {
    const row = await this.getEntityForPrincipal(id, req);
    const rows = await this.activityRepo.find({
      where: { initiativeId: row.id },
      order: { occurredAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), INITIATIVE_LIMITS.listMaxLimit),
      skip: Math.max(offset, 0),
    });
    const userIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const emails = new Map<string, string>();

    for (const userId of userIds) {
      const user = await this.usersRepository.findById(userId).catch(() => null);

      if (user?.email) {
        emails.set(userId, user.email);
      }
    }

    return rows.map((r) => initiativeActivityToDto(r, r.actorUserId ? emails.get(r.actorUserId) : null));
  }

  emitInitiative(row: InitiativeEntity): void {
    this.realtime.emitToClient(row.clientId, INITIATIVES_BOARD_EVENTS.initiativeUpsert, initiativeEntityToDto(row));
  }

  emit(
    clientId: string,
    event: (typeof INITIATIVES_BOARD_EVENTS)[keyof typeof INITIATIVES_BOARD_EVENTS],
    payload: unknown,
  ): void {
    this.realtime.emitToClient(clientId, event, payload);
  }

  publish(
    type: Parameters<AgenstraNotificationPublisher['publishInitiative']>[0],
    clientId: string,
    payload: Record<string, unknown>,
  ): void {
    try {
      this.notificationPublisher?.publishInitiative(type, clientId, payload);
    } catch (error) {
      this.logger.warn(`Initiative notification ${type} failed: ${(error as Error).message}`);
    }
  }

  notificationPayload(row: InitiativeEntity): Record<string, unknown> {
    return {
      initiativeId: row.id,
      title: row.title,
      path: row.path,
      phase: row.phase,
      state: row.state,
      iteration: row.iteration,
      version: row.version,
      longSha: row.longSha ?? null,
    };
  }

  userIdOf(principal?: ContentPrincipal): string | null {
    return principalUserId(principal);
  }

  assertNotArchived(row: InitiativeEntity): void {
    if (row.state === 'archived') {
      throw new BadRequestException('The initiative is archived; reactivate it first.');
    }
  }
}
