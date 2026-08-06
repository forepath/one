import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AddonMeterEntity } from '../entities/addon-meter.entity';

@Injectable()
export class AddonMetersRepository {
  constructor(
    @InjectRepository(AddonMeterEntity)
    private readonly repository: Repository<AddonMeterEntity>,
  ) {}

  async findByAddonId(addonId: string): Promise<AddonMeterEntity[]> {
    return await this.repository.find({
      where: { addonId },
      relations: ['meter'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByAddonIds(addonIds: string[]): Promise<AddonMeterEntity[]> {
    if (addonIds.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: { addonId: In(addonIds) },
      relations: ['meter'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByAddonAndMeter(addonId: string, meterId: string): Promise<AddonMeterEntity | null> {
    return await this.repository.findOne({
      where: { addonId, meterId },
      relations: ['meter'],
    });
  }

  async findByAddonAndMeterOrThrow(addonId: string, meterId: string): Promise<AddonMeterEntity> {
    const row = await this.findByAddonAndMeter(addonId, meterId);

    if (!row) {
      throw new NotFoundException('Addon meter attachment not found');
    }

    return row;
  }

  async countByMeterId(meterId: string): Promise<number> {
    return await this.repository.count({ where: { meterId } });
  }

  async create(dto: Partial<AddonMeterEntity>): Promise<AddonMeterEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }

  async update(id: string, dto: Partial<AddonMeterEntity>): Promise<AddonMeterEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException('Addon meter attachment not found');
    }

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async deleteByAddonAndMeter(addonId: string, meterId: string): Promise<void> {
    await this.repository.delete({ addonId, meterId });
  }

  async replaceForAddon(
    addonId: string,
    attachments: Array<{ meterId: string; unitPriceNet?: string | null }>,
  ): Promise<AddonMeterEntity[]> {
    await this.repository.delete({ addonId });

    if (attachments.length === 0) {
      return [];
    }

    const entities = attachments.map((item) =>
      this.repository.create({
        addonId,
        meterId: item.meterId,
        unitPriceNet: item.unitPriceNet ?? null,
      }),
    );

    return await this.repository.save(entities);
  }
}
