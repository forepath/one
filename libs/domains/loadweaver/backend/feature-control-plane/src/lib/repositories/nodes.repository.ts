import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';

/**
 * Repository for node inventory.
 */
@Injectable()
export class NodesRepository {
  constructor(
    @InjectRepository(NodeEntity)
    private readonly repository: Repository<NodeEntity>,
  ) {}

  async findByName(name: string): Promise<NodeEntity | null> {
    return await this.repository.findOne({ where: { name } });
  }

  async findByNameOrThrow(name: string): Promise<NodeEntity> {
    const node = await this.findByName(name);

    if (!node) {
      throw new NotFoundException(`Node '${name}' not found`);
    }

    return node;
  }

  /** All nodes that are part of the cluster (everything except nodes that have left). */
  async findMembers(): Promise<NodeEntity[]> {
    return await this.repository.find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
  }

  async findAll(): Promise<NodeEntity[]> {
    return await this.repository.find({ order: { name: 'ASC' } });
  }

  async save(node: NodeEntity): Promise<NodeEntity> {
    return await this.repository.save(node);
  }

  async update(name: string, changes: Partial<NodeEntity>): Promise<void> {
    await this.repository.update({ name }, changes);
  }
}
