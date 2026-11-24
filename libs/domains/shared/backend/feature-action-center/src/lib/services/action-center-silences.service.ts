import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';

import {
  ACTION_CENTER_MAX_SILENCES_PER_SCOPE,
  ACTION_CENTER_MAX_SILENCES_PER_USER,
} from '../constants/action-center.constants';
import type { CreateActionCenterSilenceDto } from '../dto/action-center.dto';
import { ActionCenterSilenceEntity } from '../entities/action-center-silence.entity';
import type { ActionCenterViewer } from '../interfaces/action-center.types';
import { canRemoveActionCenterSilence } from '../utils/action-center-view.utils';

import { ActionCenterRegistry } from './action-center-registry.service';

const UNIQUE_VIOLATION = '23505';

/** Persistence and permission rules of silences (self: everyone may; everyone: admins only). */
@Injectable()
export class ActionCenterSilencesService {
  constructor(
    @InjectRepository(ActionCenterSilenceEntity)
    private readonly repository: Repository<ActionCenterSilenceEntity>,
    private readonly registry: ActionCenterRegistry,
  ) {}

  /** All silences of a scope (every user plus everyone); expired rows are removed on the way. */
  async listForScope(scopeKey: string, now: Date = new Date()): Promise<ActionCenterSilenceEntity[]> {
    await this.repository.delete({ scopeKey, until: LessThanOrEqual(now) });

    return await this.repository.find({ where: { scopeKey }, order: { createdAt: 'DESC' } });
  }

  async create(viewer: ActionCenterViewer, dto: CreateActionCenterSilenceDto, now: Date = new Date()) {
    if (dto.audience === 'everyone' && viewer.role !== 'admin') {
      throw new ForbiddenException('Only admins can silence items for everyone');
    }

    if (!this.registry.isKnownType(dto.itemType)) {
      throw new BadRequestException('Unknown action center item type');
    }

    const until = dto.until ? new Date(dto.until) : null;

    if (until && until.getTime() <= now.getTime()) {
      throw new BadRequestException('until must be in the future');
    }

    const userId = dto.audience === 'everyone' ? null : viewer.userId;
    const itemId = dto.itemId ?? null;
    const existing = await this.repository.findOne({
      where: {
        scopeKey: viewer.scopeKey,
        userId: userId ?? IsNull(),
        itemType: dto.itemType,
        itemId: itemId ?? IsNull(),
      },
    });

    if (existing) {
      // Re-silencing the same target updates its end (e.g. "snooze for a week" again).
      existing.until = until;
      existing.createdByUserId = viewer.userId;

      return await this.repository.save(existing);
    }

    const [scopeCount, userCount] = await Promise.all([
      // Personal silences have their own cap, so they can never block silences for everyone.
      userId ? Promise.resolve(0) : this.repository.count({ where: { scopeKey: viewer.scopeKey, userId: IsNull() } }),
      userId ? this.repository.count({ where: { scopeKey: viewer.scopeKey, userId } }) : Promise.resolve(0),
    ]);

    if (scopeCount >= ACTION_CENTER_MAX_SILENCES_PER_SCOPE || userCount >= ACTION_CENTER_MAX_SILENCES_PER_USER) {
      throw new BadRequestException('Too many silences; remove some first');
    }

    try {
      return await this.repository.save(
        this.repository.create({
          scopeKey: viewer.scopeKey,
          userId,
          itemType: dto.itemType,
          itemId,
          until,
          createdByUserId: viewer.userId,
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new BadRequestException('This item is already silenced');
      }

      throw error;
    }
  }

  async remove(viewer: ActionCenterViewer, silenceId: string): Promise<ActionCenterSilenceEntity> {
    const silence = await this.repository.findOne({ where: { id: silenceId, scopeKey: viewer.scopeKey } });

    // Another user's personal silence is reported as missing (no enumeration of others' silences).
    if (!silence || (silence.userId !== null && silence.userId !== viewer.userId)) {
      throw new NotFoundException('Silence not found');
    }

    if (!canRemoveActionCenterSilence(silence, viewer)) {
      throw new ForbiddenException('Only admins can remove silences for everyone');
    }

    await this.repository.delete({ id: silence.id });

    return silence;
  }
}
