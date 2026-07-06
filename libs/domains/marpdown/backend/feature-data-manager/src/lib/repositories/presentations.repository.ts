import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PresentationEntity } from '../entities/presentation.entity';

@Injectable()
export class PresentationsRepository {
  constructor(
    @InjectRepository(PresentationEntity)
    private readonly repository: Repository<PresentationEntity>,
  ) {}

  async findAllByUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: PresentationEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async findByIdForUser(userId: string, id: string): Promise<PresentationEntity | null> {
    return await this.repository.findOne({ where: { id, userId } });
  }

  async findByIdOrThrow(userId: string, id: string): Promise<PresentationEntity> {
    const entity = await this.findByIdForUser(userId, id);

    if (!entity) {
      throw new NotFoundException('Presentation not found');
    }

    return entity;
  }

  async create(entity: Partial<PresentationEntity>): Promise<PresentationEntity> {
    const created = this.repository.create(entity);

    return await this.repository.save(created);
  }

  async save(entity: PresentationEntity): Promise<PresentationEntity> {
    return await this.repository.save(entity);
  }

  async delete(entity: PresentationEntity): Promise<void> {
    await this.repository.remove(entity);
  }
}
