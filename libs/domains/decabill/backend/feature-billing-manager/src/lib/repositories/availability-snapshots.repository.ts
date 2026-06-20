import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AvailabilitySnapshotEntity } from '../entities/availability-snapshot.entity';

@Injectable()
export class AvailabilitySnapshotsRepository {
  constructor(
    @InjectRepository(AvailabilitySnapshotEntity)
    private readonly repository: Repository<AvailabilitySnapshotEntity>,
  ) {}

  async create(dto: Partial<AvailabilitySnapshotEntity>): Promise<AvailabilitySnapshotEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
