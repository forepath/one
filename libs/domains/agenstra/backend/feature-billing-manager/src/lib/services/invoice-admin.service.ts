import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, Injectable } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type {
  AdminInvoiceListItemDto,
  MarkInvoicePaymentStatusDto,
  PaginatedAdminInvoicesResponseDto,
} from '../dto/admin-billing.dto';
import type { InvoiceEntity } from '../entities/invoice.entity';
import { InvoicesRepository } from '../repositories/invoices.repository';

import { BillingAuditLogService } from './billing-audit-log.service';
import { InvoiceService } from './invoice.service';

const MARK_PAID_ALLOWED: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.OVERDUE];

@Injectable()
export class InvoiceAdminService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly invoiceService: InvoiceService,
    private readonly auditLog: BillingAuditLogService,
    private readonly usersRepository: UsersRepository,
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

    await Promise.all(
      userIds.map(async (userId) => {
        const user = await this.usersRepository.findById(userId);

        if (user?.email) {
          userEmailById.set(userId, user.email);
        }
      }),
    );

    return {
      items: items.map((invoice) => ({
        ...this.invoiceService.mapToResponse(invoice, invoice.subscription?.number),
        userId: invoice.userId,
        userEmail: userEmailById.get(invoice.userId),
      })),
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async voidInvoice(invoiceRefId: string, adminUserId: string): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);
    const voided = await this.invoiceService.voidInvoice(invoiceRefId, invoice.subscriptionId, adminUserId, {
      adminUserId,
    });

    return this.mapAdminItem(voided);
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
    const updated = await this.invoicesRepository.update(invoiceRefId, {
      status: InvoiceStatus.PAID,
      balanceDue: 0,
    });

    await this.auditLog.log({
      process: 'invoice.mark_paid_manual',
      level: 'info',
      message: 'Admin marked invoice as paid',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: {
        previousStatus,
        previousBalanceDue,
        reason: dto?.reason,
        adminUserId,
      },
    });

    return this.mapAdminItem(updated);
  }

  async markUnpaidManual(
    invoiceRefId: string,
    adminUserId: string,
    dto?: MarkInvoicePaymentStatusDto,
  ): Promise<AdminInvoiceListItemDto> {
    const invoice = await this.invoicesRepository.findByIdOrThrow(invoiceRefId);

    if (invoice.status !== InvoiceStatus.PAID) {
      throw new BadRequestException('Can only mark unpaid from paid status');
    }

    const previousStatus = invoice.status;
    const today = new Date();

    today.setHours(0, 0, 0, 0);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;

    if (dueDate) {
      dueDate.setHours(0, 0, 0, 0);
    }

    const newStatus = dueDate && dueDate < today ? InvoiceStatus.OVERDUE : InvoiceStatus.ISSUED;
    const updated = await this.invoicesRepository.update(invoiceRefId, {
      status: newStatus,
      balanceDue: Number(invoice.totalGross),
    });

    await this.auditLog.log({
      process: 'invoice.mark_unpaid_manual',
      level: 'info',
      message: 'Admin marked invoice as unpaid',
      invoiceId: invoiceRefId,
      userId: invoice.userId,
      context: {
        previousStatus,
        reason: dto?.reason,
        adminUserId,
      },
    });

    return this.mapAdminItem(updated);
  }

  private async mapAdminItem(invoice: InvoiceEntity): Promise<AdminInvoiceListItemDto> {
    const base = this.invoiceService.mapToResponse(invoice, invoice.subscription?.number);
    const user = await this.usersRepository.findById(invoice.userId);

    return {
      ...base,
      userId: invoice.userId,
      userEmail: user?.email,
    };
  }
}
