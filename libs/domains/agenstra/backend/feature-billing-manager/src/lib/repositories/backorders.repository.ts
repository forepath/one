import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BackorderEntity, BackorderStatus } from '../entities/backorder.entity';

@Injectable()
export class BackordersRepository {
  constructor(
    @InjectRepository(BackorderEntity)
    private readonly repository: Repository<BackorderEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<BackorderEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Backorder with ID ${id} not found`);
    }

    return entity;
  }

  async findAllByUser(userId: string, limit = 10, offset = 0): Promise<BackorderEntity[]> {
    return await this.repository.find({
      where: { userId },
      take: limit,
      skip: offset,
      order: { createdAt: 'DESC' },
    });
  }

  async findAllPending(limit = 100, offset = 0): Promise<BackorderEntity[]> {
    return await this.repository.find({
      where: [{ status: BackorderStatus.PENDING }, { status: BackorderStatus.RETRYING }],
      take: limit,
      skip: offset,
      order: { createdAt: 'ASC' },
    });
  }

  async create(dto: Partial<BackorderEntity>): Promise<BackorderEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<BackorderEntity>): Promise<BackorderEntity> {
    const entity = await this.findByIdOrThrow(id);

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }
}
