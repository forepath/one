import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { OPEN_OVERDUE_INVOICE_STATUS_IDS } from '../constants/invoice-status.constants';
import { InvoiceRefEntity } from '../entities/invoice-ref.entity';

export interface OpenOverdueSummary {
  count: number;
  totalBalance: number;
}

@Injectable()
export class InvoiceRefsRepository {
  constructor(
    @InjectRepository(InvoiceRefEntity)
    private readonly repository: Repository<InvoiceRefEntity>,
  ) {}

  async findBySubscription(userId: string, subscriptionId: string): Promise<InvoiceRefEntity[]> {
    return await this.repository.find({
      where: { subscription: { userId }, subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findLatestBySubscription(subscriptionId: string): Promise<InvoiceRefEntity | null> {
    return await this.repository.findOne({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByIdAndSubscriptionId(id: string, subscriptionId: string): Promise<InvoiceRefEntity | null> {
    return await this.repository.findOne({
      where: { id, subscriptionId },
    });
  }

  async findById(id: string): Promise<InvoiceRefEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async findBatchForSync(batchSize: number, offset: number): Promise<InvoiceRefEntity[]> {
    return await this.repository.find({
      order: { createdAt: 'ASC' },
      take: batchSize,
      skip: offset,
    });
  }

  async findOpenOverdueByUserId(userId: string): Promise<InvoiceRefEntity[]> {
    return await this.repository.find({
      where: { subscription: { userId }, status: In(OPEN_OVERDUE_INVOICE_STATUS_IDS) },
      relations: ['subscription'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOpenOverdueSummaryByUserId(userId: string): Promise<OpenOverdueSummary> {
    const result = await this.repository
      .createQueryBuilder('ref')
      .innerJoin('ref.subscription', 'sub')
      .where('sub.userId = :userId', { userId })
      .andWhere('ref.status IN (:...statusIds)', { statusIds: OPEN_OVERDUE_INVOICE_STATUS_IDS })
      .select('COUNT(ref.id)', 'count')
      .addSelect('COALESCE(SUM(ref.balance), 0)', 'total')
      .getRawOne<{ count: string; total: string }>();
    const count = result?.count != null ? parseInt(String(result.count), 10) : 0;
    const totalBalance = result?.total != null ? parseFloat(String(result.total)) : 0;

    return { count, totalBalance };
  }

  async update(
    id: string,
    dto: Partial<Pick<InvoiceRefEntity, 'status' | 'preAuthUrl' | 'invoiceNumber' | 'balance' | 'dueDate'>>,
  ): Promise<InvoiceRefEntity> {
    const entity = await this.repository.findOne({ where: { id } });

    if (!entity) {
      throw new NotFoundException(`Invoice ref ${id} not found`);
    }

    Object.assign(entity, dto);

    return await this.repository.save(entity);
  }

  async create(dto: Partial<InvoiceRefEntity>): Promise<InvoiceRefEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
