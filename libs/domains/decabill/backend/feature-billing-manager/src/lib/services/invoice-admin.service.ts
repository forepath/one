import { randomUUID } from 'crypto';

import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';

import { DocumentDeliveryChannel } from '../constants/document-delivery.constants';
import { InvoiceStatus } from '../constants/invoice-status.constants';
import { SettlementDocumentType, SettlementSource, SettlementType } from '../constants/settlement.constants';
import type {
  AdminInvoiceListItemDto,
  InvoiceSettlementResponseDto,
  MarkInvoicePaymentStatusDto,
  PaginatedAdminInvoicesResponseDto,
  RecordInvoiceSettlementDto,
  VoidInvoiceDto,
} from '../dto/admin-billing.dto';
import { MarkDocumentSentDto, parseMarkSentAt, shouldNotify } from '../dto/document-delivery.dto';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';
import { InvoicesRepository } from '../repositories/invoices.repository';
import { DocumentDeliveryService, type SpooledDeliveryChannel } from '../spooler/document-delivery.service';
import { CustomerTrustScoreService } from '../trust-score/customer-trust-score.service';
import { resolveCustomerNamesByUserId } from '../utils/customer-display-name.util';
import { invoiceDeliveryFields } from '../utils/invoice-delivery.util';
import { resolvePaymentReceivedAt } from '../utils/resolve-payment-received-at.util';

import { BillingAuditLogService } from './billing-audit-log.service';
import { DocumentSettlementService } from './document-settlement.service';
import { InvoiceService } from './invoice.service';

const MARK_PAID_ALLOWED: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

@Injectable()
export class InvoiceAdminService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceService: InvoiceService,
    private readonly auditLog: BillingAuditLogService,
    private readonly usersRepository: UsersRepository,
    private readonly customerTrustScoreService: CustomerTrustScoreService,
    private readonly documentSettlementService: DocumentSettlementService,
    @Optional() private readonly customerProfilesRepository?: CustomerProfilesRepository,
    @Optional() private readonly billingNotificationPublisher?: BillingNotificationPublisher,
    @Optional() private readonly documentDelivery?: DocumentDeliveryService,
  ) {}

  async listInvoices(params: {
    search?: string;
    userId?: string;
    limit: number;
    offset: number;
  }): Promise<PaginatedAdminInvoicesResponseDto> {
    const { items, total } = await this.invoicesRepository.findAllForAdmin(params);
    const userIds = [...new Set(items.map((item) => item.userId))];
    const userEmailById = new Map<string, string>();
    const customerNameById = await resolveCustomerNamesByUserId(this.customerProfilesRepository, userIds);

    await Promise.all(
      userIds.map(async (userId) => {
        const user = await this.usersRepository.findByIdForTenant(userId);

        if (user?.email) {
          userEmailById.set(userId, user.email);
        }
      }),
    );

    return {
      items: items.map((invoice) => ({
        ...this.invoiceService.mapToResponse(invoice, invoice.subscription?.number),
        ...invoiceDeliveryFields(invoice),
        userId: invoice.userId,
        userEmail: userEmailById.get(invoice.userId),
        customerName: customerNameById.get(invoice.userId),
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async voidInvoice(invoiceRefId: string, adminUserId: string, dto?: VoidInvoiceDto): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);
    const notifyCustomer = shouldNotify(dto?.notifyCustomer);
    const voided = await this.invoiceService.voidInvoice(
      invoiceRefId,
      invoice.subscriptionId,
      adminUserId,
      { adminUserId, notifyCustomer },
      { note: dto?.note, skipNotification: !notifyCustomer },
    );

    return this.mapAdminItem(voided);
  }

  /**
   * Spools the email of an invoice that was issued without notification (the invoice counts as sent right away; a
   * failed or cancelled spool job releases it again).
   */
  async sendInvoice(invoiceRefId: string, adminUserId: string): Promise<AdminInvoiceListItemDto> {
    return await this.spoolSend(invoiceRefId, 'invoice', DocumentDeliveryChannel.EMAIL, adminUserId);
  }

  /** Spools the email of the credit note of an invoice that was voided without notification. */
  async sendCreditNote(invoiceRefId: string, adminUserId: string): Promise<AdminInvoiceListItemDto> {
    return await this.spoolSend(invoiceRefId, 'credit_note', DocumentDeliveryChannel.EMAIL, adminUserId);
  }

  /** Spools an invoice issued without notification as a physical letter (postal provider). */
  async sendInvoiceLetter(invoiceRefId: string, adminUserId: string): Promise<AdminInvoiceListItemDto> {
    return await this.spoolSend(invoiceRefId, 'invoice', DocumentDeliveryChannel.LETTER, adminUserId);
  }

  /** Spools the credit note of an invoice voided without notification as a physical letter. */
  async sendCreditNoteLetter(invoiceRefId: string, adminUserId: string): Promise<AdminInvoiceListItemDto> {
    return await this.spoolSend(invoiceRefId, 'credit_note', DocumentDeliveryChannel.LETTER, adminUserId);
  }

  private async spoolSend(
    invoiceRefId: string,
    document: 'invoice' | 'credit_note',
    channel: SpooledDeliveryChannel,
    adminUserId: string,
  ): Promise<AdminInvoiceListItemDto> {
    if (!this.documentDelivery) {
      throw new BadRequestException('Document delivery is not available');
    }

    const { invoice, job } =
      document === 'invoice'
        ? await this.documentDelivery.spoolInvoice(invoiceRefId, channel, adminUserId)
        : await this.documentDelivery.spoolCreditNote(invoiceRefId, channel, adminUserId);

    return { ...(await this.mapAdminItem(invoice)), spoolJobId: job.id };
  }

  /** Records that an invoice issued without notification was sent outside Decabill. */
  async markInvoiceSent(
    invoiceRefId: string,
    adminUserId: string,
    dto?: MarkDocumentSentDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);
    const sent = await this.invoiceService.markInvoiceSent(invoice, parseMarkSentAt(dto));

    await this.auditLog.log({
      process: 'invoice.mark_sent',
      level: 'info',
      message: `Marked invoice ${invoice.invoiceNumber ?? invoiceRefId} as sent`,
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { adminUserId, invoiceNumber: invoice.invoiceNumber, sentAt: sent.sentAt },
    });

    return this.mapAdminItem(sent);
  }

  /** Records that the credit note of a voided invoice was sent outside Decabill. */
  async markCreditNoteSent(
    invoiceRefId: string,
    adminUserId: string,
    dto?: MarkDocumentSentDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);
    const sent = await this.invoiceService.markVoidDocumentSent(invoice, parseMarkSentAt(dto));

    await this.auditLog.log({
      process: 'invoice.void_document_mark_sent',
      level: 'info',
      message: `Marked credit note for invoice ${invoice.invoiceNumber ?? invoiceRefId} as sent`,
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { adminUserId, invoiceNumber: invoice.invoiceNumber, sentAt: sent.voidDocumentSentAt },
    });

    return this.mapAdminItem(sent);
  }

  async markPaidManual(
    invoiceRefId: string,
    adminUserId: string,
    dto?: MarkInvoicePaymentStatusDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    if (!MARK_PAID_ALLOWED.includes(invoice.status)) {
      throw new BadRequestException(`Cannot mark invoice as paid from status ${invoice.status}`);
    }

    const previousStatus = invoice.status;
    const previousBalanceDue = Number(invoice.balanceDue);
    const amount = dto?.amount ?? previousBalanceDue;

    if (amount <= 0) {
      throw new BadRequestException('Nothing left to pay on this invoice');
    }

    const paidAt = resolvePaymentReceivedAt(dto?.paidAt);
    const result = await this.documentSettlementService.apply({
      documentType: SettlementDocumentType.INVOICE,
      documentId: invoiceRefId,
      type: SettlementType.PAYMENT,
      amount,
      currency: invoice.currency,
      occurredAt: paidAt,
      source: SettlementSource.MANUAL,
      sourceRef: `manual:${randomUUID()}`,
      note: dto?.reason ?? null,
      createdByUserId: adminUserId,
    });
    const updated = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    await this.auditLog.log({
      process: 'invoice.mark_paid_manual',
      level: 'info',
      message: result.becameSettled ? 'Admin marked invoice as paid' : 'Admin recorded a partial payment',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: {
        previousStatus,
        previousBalanceDue,
        amount,
        reason: dto?.reason,
        paidAt: paidAt.toISOString(),
        adminUserId,
        settlementId: result.settlement.id,
      },
    });

    if (result.becameSettled) {
      this.billingNotificationPublisher?.publishInvoice('invoice.paid', updated);
    }

    this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

    return this.mapAdminItem(updated);
  }

  /** Reverses all cash received so far (e.g. a returned transfer); credits and write-offs stay applied. */
  async markUnpaidManual(
    invoiceRefId: string,
    adminUserId: string,
    dto?: MarkInvoicePaymentStatusDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    if (invoice.status !== InvoiceStatus.PAID && invoice.status !== InvoiceStatus.PARTIALLY_PAID) {
      throw new BadRequestException('Can only mark unpaid from paid or partially paid status');
    }

    const settlements = await this.documentSettlementService.listForDocument(
      SettlementDocumentType.INVOICE,
      invoiceRefId,
    );
    const cashNet =
      settlements.filter((s) => s.type === SettlementType.PAYMENT).reduce((sum, s) => sum + Number(s.amount), 0) -
      settlements
        .filter((s) => s.type === SettlementType.PAYMENT_REVERSAL || s.type === SettlementType.REFUND)
        .reduce((sum, s) => sum + Number(s.amount), 0);
    const amount = Math.round(cashNet * 100) / 100;

    if (amount <= 0) {
      throw new BadRequestException('No payment recorded on this invoice');
    }

    const previousStatus = invoice.status;
    const lastPayment = [...settlements].reverse().find((s) => s.type === SettlementType.PAYMENT);

    await this.documentSettlementService.apply({
      documentType: SettlementDocumentType.INVOICE,
      documentId: invoiceRefId,
      type: SettlementType.PAYMENT_REVERSAL,
      amount,
      currency: invoice.currency,
      occurredAt: dto?.paidAt ? resolvePaymentReceivedAt(dto.paidAt) : new Date(),
      source: SettlementSource.MANUAL,
      sourceRef: `manual-reversal:${randomUUID()}`,
      reversesSettlementId: lastPayment?.id ?? null,
      note: dto?.reason ?? null,
      createdByUserId: adminUserId,
    });

    const updated = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    await this.auditLog.log({
      process: 'invoice.mark_unpaid_manual',
      level: 'info',
      message: 'Admin marked invoice as unpaid',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: {
        previousStatus,
        reversedAmount: amount,
        reason: dto?.reason,
        adminUserId,
      },
    });
    this.billingNotificationPublisher?.publishInvoice('invoice.unpaid', updated);

    this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

    return this.mapAdminItem(updated);
  }

  /** Writes off the remaining (or given) balance as uncollectible. */
  async writeOff(
    invoiceRefId: string,
    adminUserId: string,
    dto?: RecordInvoiceSettlementDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    if (!MARK_PAID_ALLOWED.includes(invoice.status)) {
      throw new BadRequestException(`Cannot write off an invoice in status ${invoice.status}`);
    }

    const amount = dto?.amount ?? Number(invoice.balanceDue);

    if (amount <= 0 || amount > Number(invoice.balanceDue) + 0.005) {
      throw new BadRequestException('Write-off amount must be positive and not exceed the balance due');
    }

    const result = await this.documentSettlementService.apply({
      documentType: SettlementDocumentType.INVOICE,
      documentId: invoiceRefId,
      type: SettlementType.WRITE_OFF,
      amount,
      currency: invoice.currency,
      occurredAt: dto?.occurredAt ? new Date(dto.occurredAt) : new Date(),
      source: SettlementSource.MANUAL,
      sourceRef: `write-off:${randomUUID()}`,
      note: dto?.reason ?? null,
      createdByUserId: adminUserId,
    });

    await this.auditLog.log({
      process: 'invoice.write_off',
      level: 'info',
      message: 'Admin wrote off invoice balance',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { amount, reason: dto?.reason, adminUserId, settlementId: result.settlement.id },
    });
    this.customerTrustScoreService.triggerRecomputeForUser(invoice.userId);

    const updated = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    this.billingNotificationPublisher?.publishInvoice('invoice.written_off', updated);

    return this.mapAdminItem(updated);
  }

  /** Records money paid back to the customer outside the processor (e.g. bank transfer of a credit). */
  async recordManualRefund(
    invoiceRefId: string,
    adminUserId: string,
    dto?: RecordInvoiceSettlementDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);
    const credit = -Number(invoice.balanceDue);

    if (credit <= 0.005) {
      throw new BadRequestException('Invoice has no customer credit to refund');
    }

    const amount = dto?.amount ?? credit;

    if (amount <= 0 || amount > credit + 0.005) {
      throw new BadRequestException('Refund amount must be positive and not exceed the customer credit');
    }

    const result = await this.documentSettlementService.apply({
      documentType: SettlementDocumentType.INVOICE,
      documentId: invoiceRefId,
      type: SettlementType.REFUND,
      amount,
      currency: invoice.currency,
      occurredAt: dto?.occurredAt ? new Date(dto.occurredAt) : new Date(),
      source: SettlementSource.MANUAL,
      sourceRef: `manual-refund:${randomUUID()}`,
      note: dto?.reason ?? null,
      createdByUserId: adminUserId,
    });

    await this.auditLog.log({
      process: 'invoice.refund_manual',
      level: 'info',
      message: 'Admin recorded a manual refund',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: { amount, reason: dto?.reason, adminUserId, settlementId: result.settlement.id },
    });
    this.billingNotificationPublisher?.publishInvoice('invoice.refunded', result.document as InvoiceEntity);

    return this.mapAdminItem(await this.invoicesRepository.findByIdOrThrow(invoiceRefId));
  }

  async listSettlements(invoiceRefId: string): Promise<InvoiceSettlementResponseDto[]> {
    await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    const settlements = await this.documentSettlementService.listForDocument(
      SettlementDocumentType.INVOICE,
      invoiceRefId,
    );

    return settlements.map((s) => ({
      id: s.id,
      type: s.type,
      amount: Number(s.amount),
      currency: s.currency,
      occurredAt: new Date(s.occurredAt).toISOString(),
      source: s.source,
      processor: s.processor ?? null,
      externalId: s.externalId ?? null,
      creditDocumentId: s.creditDocumentId ?? null,
      relatedDocumentId: s.relatedDocumentId ?? null,
      note: s.note ?? null,
      createdAt: new Date(s.createdAt).toISOString(),
    }));
  }

  private async mapAdminItem(invoice: InvoiceEntity): Promise<AdminInvoiceListItemDto> {
    const base = this.invoiceService.mapToResponse(invoice, invoice.subscription?.number);
    const user = await this.usersRepository.findByIdForTenant(invoice.userId);

    return {
      ...base,
      ...invoiceDeliveryFields(invoice),
      userId: invoice.userId,
      userEmail: user?.email,
    };
  }
}
