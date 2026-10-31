import type { RequestWithUser } from '@forepath/identity/backend';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import { ProjectAccessService } from '../access/project-access.service';
import { fleetIdentityOf, isFleetRelayCaller } from '../fleet-identity/fleet-identity.utils';
import { actorFromRequest, AuditLogService, ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';
import { SavedViewEntity } from './saved-view.entity';

/** Views per owner (all scopes). */
export const MAX_SAVED_VIEWS_PER_OWNER = 200;
/** Serialized `state` (UTF-8 bytes of its JSON). */
export const MAX_SAVED_VIEW_STATE_BYTES = 16 * 1024;

export interface SavedViewDto {
  id: string;
  scope: string;
  name: string;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function toDto(view: SavedViewEntity): SavedViewDto {
  return {
    id: view.id,
    scope: view.scope,
    name: view.name,
    state: view.state ?? {},
    createdAt: new Date(view.createdAt).toISOString(),
    updatedAt: new Date(view.updatedAt).toISOString(),
  };
}

/** A plain JSON object of at most {@link MAX_SAVED_VIEW_STATE_BYTES} serialized. */
export function assertViewState(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new BadRequestException('state must be an object');

  const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');

  if (bytes > MAX_SAVED_VIEW_STATE_BYTES)
    throw new BadRequestException(`state is ${bytes} bytes, at most ${MAX_SAVED_VIEW_STATE_BYTES} are allowed`);

  return state as Record<string, unknown>;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } } | null;

  return e?.code === '23505' || e?.driverError?.code === '23505';
}

/**
 * Saved views / filters per user, server-side (3.37): every caller sees and changes only their own rows. The owner is
 * the user id (or `api-key`); through a fleet always the verified person (`fleet:<iss>:<sub>`), never the fleet's
 * service account — like search favourites. Every change is audited (`view.create|update|delete`).
 */
@Injectable()
export class SavedViewsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditLogService,
  ) {}

  /** The owner of the caller's views, or null (a fleet relay without a verified person, a caller without a user). */
  async owner(req: RequestWithUser | undefined): Promise<string | null> {
    if (isFleetRelayCaller(req, ON_BEHALF_OF_SCOPE) && !fleetIdentityOf(req)) return null;

    const caller = await this.access.caller(req);

    return caller.userId ?? (caller.isApiKey ? 'api-key' : null);
  }

  private async requireOwner(req: RequestWithUser | undefined): Promise<string> {
    const owner = await this.owner(req);

    if (!owner)
      throw isFleetRelayCaller(req, ON_BEHALF_OF_SCOPE)
        ? new ForbiddenException('saved views through a fleet need a verified fleet identity')
        : new BadRequestException('saved views need a user');

    return owner;
  }

  async list(req: RequestWithUser | undefined, scope?: string): Promise<SavedViewDto[]> {
    const owner = await this.owner(req);

    if (!owner) return [];

    const views = await this.dataSource.getRepository(SavedViewEntity).find({
      where: { owner, ...(scope ? { scope } : {}) },
      order: { scope: 'ASC', name: 'ASC' },
      take: MAX_SAVED_VIEWS_PER_OWNER,
    });

    return views.map(toDto);
  }

  async create(
    req: RequestWithUser | undefined,
    input: { scope: string; name: string; state: unknown },
  ): Promise<SavedViewDto> {
    const owner = await this.requireOwner(req);
    const name = input.name.trim();
    const state = assertViewState(input.state);

    if (!name) throw new BadRequestException('name must not be empty');

    return await this.write(async (manager) => {
      const repo = manager.getRepository(SavedViewEntity);

      if ((await repo.count({ where: { owner } })) >= MAX_SAVED_VIEWS_PER_OWNER)
        throw new BadRequestException(`at most ${MAX_SAVED_VIEWS_PER_OWNER} saved views per user`);

      await this.assertFree(manager, owner, input.scope, name);

      const view = await repo.save(repo.create({ owner, scope: input.scope, name, state }));

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'view.create',
        target: `view/${view.scope}/${view.name}`,
        project: null,
        details: { id: view.id },
      });

      return toDto(view);
    });
  }

  async update(
    req: RequestWithUser | undefined,
    id: string,
    input: { name?: string; state?: unknown },
  ): Promise<SavedViewDto> {
    const owner = await this.requireOwner(req);
    const name = input.name?.trim();

    if (name === undefined && input.state === undefined) throw new BadRequestException('nothing to change');

    if (name === '') throw new BadRequestException('name must not be empty');

    const state = input.state === undefined ? undefined : assertViewState(input.state);

    return await this.write(async (manager) => {
      const view = await this.own(manager, owner, id);
      const previous = view.name;

      if (name !== undefined && name !== view.name) {
        await this.assertFree(manager, owner, view.scope, name);
        view.name = name;
      }

      if (state !== undefined) view.state = state;

      const saved = await manager.getRepository(SavedViewEntity).save(view);

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'view.update',
        target: `view/${saved.scope}/${saved.name}`,
        project: null,
        details: {
          id: saved.id,
          ...(previous !== saved.name ? { renamedFrom: previous } : {}),
          ...(state !== undefined ? { state: true } : {}),
        },
      });

      return toDto(saved);
    });
  }

  async remove(req: RequestWithUser | undefined, id: string): Promise<void> {
    const owner = await this.requireOwner(req);

    await this.write(async (manager) => {
      const view = await this.own(manager, owner, id);

      await manager.getRepository(SavedViewEntity).delete({ id: view.id, owner });
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'view.delete',
        target: `view/${view.scope}/${view.name}`,
        project: null,
        details: { id: view.id },
      });
    });
  }

  /** A transaction that answers a lost race on (owner, scope, name) with 409. */
  private async write<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('a view with this name already exists in this scope');

      throw error;
    }
  }

  private async own(manager: EntityManager, owner: string, id: string): Promise<SavedViewEntity> {
    const view = await manager.getRepository(SavedViewEntity).findOne({ where: { id, owner } });

    if (!view) throw new NotFoundException('view not found');

    return view;
  }

  private async assertFree(manager: EntityManager, owner: string, scope: string, name: string): Promise<void> {
    if (await manager.getRepository(SavedViewEntity).findOne({ where: { owner, scope, name } }))
      throw new ConflictException('a view with this name already exists in this scope');
  }
}
