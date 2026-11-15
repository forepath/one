import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { TaxCategory } from '../constants/tax-category.constants';
import { InvoiceCreditDocumentEntity } from '../entities/invoice-credit-document.entity';
import { configChangePrimarySourceRef } from '../utils/config-change-billing-source-ref.util';
import { isUniqueConstraintViolation } from '../utils/postgres-unique-violation.util';
import { applyUserTenantFilter } from '../utils/tenant-query.utils';

@Injectable()
export class InvoiceCreditDocumentsRepository {
  constructor(
    @InjectRepository(InvoiceCreditDocumentEntity)
    private readonly repository: Repository<InvoiceCreditDocumentEntity>,
  ) {}

  async findByInvoiceId(invoiceId: string): Promise<InvoiceCreditDocumentEntity[]> {
    return await this.repository.find({ where: { invoiceId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Durable idempotency lookup for config-change partial credits (billed or not).
   * Matches the change id embedded in the credit description.
   */
  async findConfigChangeCredit(configChangeId: string): Promise<InvoiceCreditDocumentEntity | null> {
    const bySourceRef = await this.findBySourceRef(configChangePrimarySourceRef(configChangeId));

    if (bySourceRef) {
      return bySourceRef;
    }

    const qb = this.repository
      .createQueryBuilder('credit')
      .innerJoin('credit.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .where('credit.reason = :reason', { reason: 'config_change' })
      .andWhere('credit.description LIKE :marker', { marker: `%${configChangeId}%` })
      .orderBy('credit.createdAt', 'ASC')
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async findBySourceRef(sourceRef: string): Promise<InvoiceCreditDocumentEntity | null> {
    const qb = this.repository
      .createQueryBuilder('credit')
      .innerJoin('credit.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .where('credit.source_ref = :sourceRef', { sourceRef })
      .take(1);

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async createUniqueBySourceRef(dto: {
    invoiceId: string;
    documentNumber: string;
    creditNet: number;
    creditGross: number;
    pdfStorageKey: string;
    reason: string;
    withdrawnAt: Date;
    sourceRef: string;
    taxCategory?: TaxCategory;
    description?: string;
  }): Promise<{ entity: InvoiceCreditDocumentEntity; created: boolean }> {
    const entity = this.repository.create({
      taxCategory: TaxCategory.STANDARD,
      description: '',
      settlementComplete: false,
      ...dto,
    });

    try {
      const saved = await this.repository.save(entity);

      return { entity: saved, created: true };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      const existing = await this.findBySourceRef(dto.sourceRef);

      if (!existing) {
        throw error;
      }

      return { entity: existing, created: false };
    }
  }

  /**
   * True when the storage key matches a credit PDF for an invoice in the current tenant.
   */
  async existsAuthorizedByPdfStorageKey(storageKey: string): Promise<boolean> {
    const qb = this.repository
      .createQueryBuilder('credit')
      .innerJoin('credit.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .where('credit.pdf_storage_key = :storageKey', { storageKey });

    applyUserTenantFilter(qb, 'user');

    return (await qb.getCount()) > 0;
  }

  async findByIdForUpdate(id: string, manager: EntityManager): Promise<InvoiceCreditDocumentEntity | null> {
    const qb = manager
      .getRepository(InvoiceCreditDocumentEntity)
      .createQueryBuilder('credit')
      .innerJoin('credit.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .where('credit.id = :id', { id })
      .setLock('pessimistic_write');

    applyUserTenantFilter(qb, 'user');

    return await qb.getOne();
  }

  async markSettlementComplete(id: string, manager?: EntityManager): Promise<void> {
    const repository = manager ? manager.getRepository(InvoiceCreditDocumentEntity) : this.repository;

    await repository.update(id, { settlementComplete: true });
  }

  async create(dto: {
    invoiceId: string;
    documentNumber: string;
    creditNet: number;
    creditGross: number;
    pdfStorageKey: string;
    reason: string;
    withdrawnAt: Date;
    taxCategory?: TaxCategory;
    description?: string;
  }): Promise<InvoiceCreditDocumentEntity> {
    const entity = this.repository.create({
      taxCategory: TaxCategory.STANDARD,
      description: '',
      ...dto,
    });

    return await this.repository.save(entity);
  }

  async findWithdrawnInPeriod(from: Date, to: Date): Promise<InvoiceCreditDocumentEntity[]> {
    const qb = this.repository
      .createQueryBuilder('credit')
      .innerJoinAndSelect('credit.invoice', 'invoice')
      .innerJoin('users', 'user', 'user.id = invoice.user_id')
      .leftJoinAndSelect('invoice.lineItems', 'lineItems')
      .where('credit.withdrawn_at >= :from', { from })
      .andWhere('credit.withdrawn_at <= :to', { to })
      .orderBy('credit.withdrawn_at', 'ASC');

    applyUserTenantFilter(qb, 'user');

    return await qb.getMany();
  }
}
