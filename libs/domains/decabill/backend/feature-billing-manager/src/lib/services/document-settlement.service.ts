import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { ACCOUNTING_POSTING_PORT, type AccountingPostingPort } from '../accounting/ports/accounting-posting.port';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SettlementDocumentType, SettlementSource, SettlementType } from '../constants/settlement.constants';
import { DocumentSettlementEntity } from '../entities/document-settlement.entity';
import { InvoiceEntity } from '../entities/invoice.entity';
import { SupplierInvoiceEntity } from '../entities/supplier-invoice.entity';
import { deriveSettlementState, roundMoney } from '../utils/settlement-state.util';

export interface ApplySettlementInput {
  documentType: SettlementDocumentType;
  documentId: string;
  type: SettlementType;
  amount: number;
  currency?: string;
  occurredAt: Date;
  source: SettlementSource;
  sourceRef: string;
  processor?: string | null;
  externalId?: string | null;
  paymentAttemptId?: string | null;
  creditDocumentId?: string | null;
  paymentRefundId?: string | null;
  bankTransactionId?: string | null;
  relatedDocumentId?: string | null;
  reversesSettlementId?: string | null;
  note?: string | null;
  createdByUserId?: string | null;
}

export type SettledDocument = InvoiceEntity | SupplierInvoiceEntity;

export interface ApplySettlementResult {
  settlement: DocumentSettlementEntity;
  /** False when the same (document, type, sourceRef) was applied before (idempotent replay). */
  created: boolean;
  document: SettledDocument;
  previousStatus: InvoiceStatus;
  /** True when this settlement moved the document from open into a settled status. */
  becameSettled: boolean;
}

const SETTLED_STATUSES: InvoiceStatus[] = [InvoiceStatus.PAID, InvoiceStatus.CREDITED, InvoiceStatus.WRITTEN_OFF];
const SETTLEABLE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.OVERDUE,
  InvoiceStatus.PARTIALLY_PAID,
  ...SETTLED_STATUSES,
];

/**
 * Single writer of invoice / supplier invoice balances. Every payment, credit, refund, write-off and customer
 * credit transfer becomes a settlement row; balance due, status and paid date are re-derived under a row lock in
 * the same transaction, and the accounting posting hook runs inside it.
 */
@Injectable()
export class DocumentSettlementService {
  private readonly logger = new Logger(DocumentSettlementService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Optional() @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort?: AccountingPostingPort,
  ) {}

  /** Applies a settlement (own transaction unless a manager is passed). */
  async apply(input: ApplySettlementInput, manager?: EntityManager): Promise<ApplySettlementResult> {
    if (manager) {
      return await this.applyInManager(input, manager);
    }

    return await this.dataSource.transaction(async (m) => await this.applyInManager(input, m));
  }

  async listForDocument(
    documentType: SettlementDocumentType,
    documentId: string,
    manager?: EntityManager,
  ): Promise<DocumentSettlementEntity[]> {
    const repo = (manager ?? this.dataSource.manager).getRepository(DocumentSettlementEntity);

    return await repo.find({ where: { documentType, documentId }, order: { occurredAt: 'ASC', createdAt: 'ASC' } });
  }

  /**
   * Recomputes balance and status from the stored settlements (e.g. after the due date passed or to repair rows).
   */
  async recompute(
    documentType: SettlementDocumentType,
    documentId: string,
    manager?: EntityManager,
  ): Promise<SettledDocument> {
    const run = async (m: EntityManager): Promise<SettledDocument> => {
      const document = await this.lockDocument(documentType, documentId, m);

      if (!SETTLEABLE_STATUSES.includes(document.status)) {
        return document;
      }

      await this.refreshState(documentType, document, m);

      return document;
    };

    return manager ? await run(manager) : await this.dataSource.transaction(run);
  }

  /**
   * Customer credit: negative balances of the customer's other issued invoices settle `invoiceId` (oldest first).
   * Returns the gross amount applied.
   */
  async applyAvailableCustomerCredit(
    invoiceId: string,
    manager: EntityManager,
    occurredAt = new Date(),
  ): Promise<number> {
    const target = await this.lockDocument(SettlementDocumentType.INVOICE, invoiceId, manager);

    if (!SETTLEABLE_STATUSES.includes(target.status) || Number(target.balanceDue) <= 0.005) {
      return 0;
    }

    const userId = (target as InvoiceEntity).userId;
    const sources = await manager
      .getRepository(InvoiceEntity)
      .createQueryBuilder('inv')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.id != :id', { id: invoiceId })
      .andWhere('inv.balance_due < 0')
      .andWhere('inv.currency = :currency', { currency: target.currency })
      .andWhere('inv.status IN (:...statuses)', { statuses: SETTLEABLE_STATUSES })
      .orderBy('inv.issued_at', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    let remaining = roundMoney(Number(target.balanceDue));
    let applied = 0;

    for (const source of sources) {
      if (remaining <= 0.005) {
        break;
      }

      const available = roundMoney(-Number(source.balanceDue));
      const amount = roundMoney(Math.min(available, remaining));

      if (amount <= 0.005) {
        continue;
      }

      const ref = `transfer:${source.id}:${invoiceId}:${occurredAt.getTime()}`;

      await this.applyInManager(
        {
          documentType: SettlementDocumentType.INVOICE,
          documentId: source.id,
          type: SettlementType.CREDIT_TRANSFER_OUT,
          amount,
          currency: source.currency,
          occurredAt,
          source: SettlementSource.CUSTOMER_CREDIT,
          sourceRef: ref,
          relatedDocumentId: invoiceId,
        },
        manager,
      );
      await this.applyInManager(
        {
          documentType: SettlementDocumentType.INVOICE,
          documentId: invoiceId,
          type: SettlementType.CREDIT_TRANSFER_IN,
          amount,
          currency: target.currency,
          occurredAt,
          source: SettlementSource.CUSTOMER_CREDIT,
          sourceRef: ref,
          relatedDocumentId: source.id,
        },
        manager,
      );
      remaining = roundMoney(remaining - amount);
      applied = roundMoney(applied + amount);
    }

    return applied;
  }

  /** Available customer credit (sum of negative balances of issued invoices) per currency. */
  async getCustomerCredit(
    userId: string,
    manager?: EntityManager,
  ): Promise<Array<{ currency: string; amount: number }>> {
    const rows: Array<{ currency: string; amount: string }> = await (manager ?? this.dataSource.manager)
      .getRepository(InvoiceEntity)
      .createQueryBuilder('inv')
      .select('inv.currency', 'currency')
      .addSelect('-SUM(inv.balance_due)', 'amount')
      .where('inv.user_id = :userId', { userId })
      .andWhere('inv.balance_due < 0')
      .andWhere('inv.status IN (:...statuses)', { statuses: SETTLEABLE_STATUSES })
      .groupBy('inv.currency')
      .getRawMany();

    return rows.map((r) => ({ currency: r.currency, amount: roundMoney(Number(r.amount)) }));
  }

  private async applyInManager(input: ApplySettlementInput, manager: EntityManager): Promise<ApplySettlementResult> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadRequestException('Settlement amount must be positive');
    }

    const document = await this.lockDocument(input.documentType, input.documentId, manager);
    const previousStatus = document.status;
    const repo = manager.getRepository(DocumentSettlementEntity);
    const existing = await repo.findOne({
      where: {
        documentType: input.documentType,
        documentId: input.documentId,
        type: input.type,
        sourceRef: input.sourceRef,
      },
    });

    if (existing) {
      return { settlement: existing, created: false, document, previousStatus, becameSettled: false };
    }

    if (!SETTLEABLE_STATUSES.includes(document.status)) {
      throw new BadRequestException(`Cannot settle a document in status ${document.status}`);
    }

    const currency = input.currency ?? document.currency;

    if (currency.toUpperCase() !== document.currency.toUpperCase()) {
      throw new BadRequestException(
        `Settlement currency ${currency} does not match document currency ${document.currency}`,
      );
    }

    const settlement = await repo.save(
      repo.create({
        documentType: input.documentType,
        documentId: input.documentId,
        type: input.type,
        amount: roundMoney(input.amount),
        currency: document.currency,
        occurredAt: input.occurredAt,
        source: input.source,
        sourceRef: input.sourceRef,
        processor: input.processor ?? null,
        externalId: input.externalId ?? null,
        paymentAttemptId: input.paymentAttemptId ?? null,
        creditDocumentId: input.creditDocumentId ?? null,
        paymentRefundId: input.paymentRefundId ?? null,
        bankTransactionId: input.bankTransactionId ?? null,
        relatedDocumentId: input.relatedDocumentId ?? null,
        reversesSettlementId: input.reversesSettlementId ?? null,
        note: input.note ?? null,
        createdByUserId: input.createdByUserId ?? null,
      }),
    );

    await this.refreshState(input.documentType, document, manager);
    await this.postingPort?.onSettlementApplied(manager, settlement.id);

    return {
      settlement,
      created: true,
      document,
      previousStatus,
      becameSettled: !SETTLED_STATUSES.includes(previousStatus) && SETTLED_STATUSES.includes(document.status),
    };
  }

  private async refreshState(
    documentType: SettlementDocumentType,
    document: SettledDocument,
    manager: EntityManager,
  ): Promise<void> {
    const settlements = await this.listForDocument(documentType, document.id, manager);
    const state = deriveSettlementState({
      totalGross: document.totalGross,
      dueDate: document.dueDate ?? null,
      settlements: settlements.map((s) => ({ type: s.type, amount: s.amount, occurredAt: new Date(s.occurredAt) })),
    });

    document.balanceDue = state.balanceDue;
    document.status = state.status;
    document.paidAt = state.paidAt;

    if (documentType === SettlementDocumentType.INVOICE) {
      await manager
        .getRepository(InvoiceEntity)
        .update(document.id, { balanceDue: state.balanceDue, status: state.status, paidAt: state.paidAt });
    } else {
      await manager
        .getRepository(SupplierInvoiceEntity)
        .update(document.id, { balanceDue: state.balanceDue, status: state.status, paidAt: state.paidAt });
    }
  }

  private async lockDocument(
    documentType: SettlementDocumentType,
    documentId: string,
    manager: EntityManager,
  ): Promise<SettledDocument> {
    const entity = documentType === SettlementDocumentType.INVOICE ? InvoiceEntity : SupplierInvoiceEntity;
    const document = (await manager
      .getRepository<SettledDocument>(entity)
      .createQueryBuilder('doc')
      .where('doc.id = :id', { id: documentId })
      .setLock('pessimistic_write')
      .getOne()) as SettledDocument | null;

    if (!document) {
      this.logger.warn(`Settlement target ${documentType} ${documentId} not found`);

      throw new NotFoundException(`${documentType} ${documentId} not found`);
    }

    return document;
  }
}
