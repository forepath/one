import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OfferFulfillmentStatus } from '../constants/offer-fulfillment-status.constants';
import { OfferStatus } from '../constants/offer-status.constants';
import { OfferLineItemEntity } from '../entities/offer-line-item.entity';

@Injectable()
export class OfferLineItemsRepository {
  constructor(
    @InjectRepository(OfferLineItemEntity)
    private readonly repository: Repository<OfferLineItemEntity>,
  ) {}

  async deleteByOfferId(offerId: string): Promise<void> {
    await this.repository.delete({ offerId });
  }

  async createMany(lines: Partial<OfferLineItemEntity>[]): Promise<OfferLineItemEntity[]> {
    const entities = lines.map((line) => this.repository.create(line));

    return await this.repository.save(entities);
  }

  async findByOfferId(offerId: string): Promise<OfferLineItemEntity[]> {
    return await this.repository.find({
      where: { offerId },
      order: { position: 'ASC' },
    });
  }

  async update(id: string, data: Partial<OfferLineItemEntity>): Promise<OfferLineItemEntity> {
    await this.repository.update(id, data);

    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Offer line item ${id} not found after update`);
    }

    return entity;
  }

  async findByIdOrThrow(id: string): Promise<OfferLineItemEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new Error(`Offer line item ${id} not found`);
    }

    return entity;
  }

  async findDueScheduledLines(before: Date): Promise<OfferLineItemEntity[]> {
    return await this.repository
      .createQueryBuilder('line')
      .innerJoin('billing_offers', 'offer', 'offer.id = line.offer_id')
      .where('line.fulfillment_status = :status', { status: OfferFulfillmentStatus.SCHEDULED })
      .andWhere('line.scheduled_at IS NOT NULL')
      .andWhere('line.scheduled_at <= :before', { before })
      .andWhere('offer.status = :offerStatus', { offerStatus: OfferStatus.ACCEPTED })
      .getMany();
  }
}
