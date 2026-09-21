import { Injectable, Logger } from '@nestjs/common';
import { getTenantIdOrDefault } from '@forepath/shared/backend';

import type { BillingAuditLogResponseDto } from '../dto/admin-billing.dto';
import type { BillingAuditLogEntity } from '../entities/billing-audit-log.entity';
import { BillingAuditLogsRepository } from '../repositories/billing-audit-logs.repository';

@Injectable()
export class BillingAuditLogService {
  private readonly logger = new Logger(BillingAuditLogService.name);

  constructor(private readonly auditLogsRepository: BillingAuditLogsRepository) {}

  /** Matches `billing_audit_logs.correlation_id` varchar(64). */
  private static readonly CORRELATION_ID_MAX_LENGTH = 64;

  async log(params: {
    process: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    invoiceId?: string;
    offerId?: string;
    userId?: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    const { process, level, message, invoiceId, offerId, userId, context } = params;
    const correlationId = this.clampCorrelationId(params.correlationId);

    if (level === 'error') {
      this.logger.error(`[${process}] ${message}`, context);
    } else if (level === 'warn') {
      this.logger.warn(`[${process}] ${message}`, context);
    } else {
      this.logger.log(`[${process}] ${message}`, context);
    }

    await this.auditLogsRepository.create({
      process,
      level,
      message,
      invoiceId,
      offerId,
      userId,
      correlationId,
      tenantId: getTenantIdOrDefault(),
      context: context ?? {},
    });
  }

  private clampCorrelationId(correlationId?: string): string | undefined {
    if (!correlationId) {
      return undefined;
    }

    if (correlationId.length <= BillingAuditLogService.CORRELATION_ID_MAX_LENGTH) {
      return correlationId;
    }

    this.logger.warn(
      `Audit correlationId exceeds ${BillingAuditLogService.CORRELATION_ID_MAX_LENGTH} chars; truncating`,
      { length: correlationId.length },
    );

    return correlationId.slice(0, BillingAuditLogService.CORRELATION_ID_MAX_LENGTH);
  }

  async listForOffer(
    offerId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BillingAuditLogResponseDto[]; total: number }> {
    const result = await this.auditLogsRepository.findByOfferId(offerId, limit, offset);

    return {
      items: result.items.map((row) => this.mapToResponse(row)),
      total: result.total,
    };
  }

  async listForInvoice(
    invoiceId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BillingAuditLogResponseDto[]; total: number }> {
    const result = await this.auditLogsRepository.findByInvoiceId(invoiceId, limit, offset);

    return {
      items: result.items.map((row) => this.mapToResponse(row)),
      total: result.total,
    };
  }

  async listForSupplierInvoice(
    supplierInvoiceId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: BillingAuditLogResponseDto[]; total: number }> {
    const result = await this.auditLogsRepository.findBySupplierInvoiceId(supplierInvoiceId, limit, offset);

    return {
      items: result.items.map((row) => this.mapToResponse(row)),
      total: result.total,
    };
  }

  private mapToResponse(entity: BillingAuditLogEntity): BillingAuditLogResponseDto {
    return {
      id: entity.id,
      process: entity.process,
      level: entity.level,
      message: entity.message,
      invoiceId: entity.invoiceId,
      offerId: entity.offerId,
      userId: entity.userId,
      context: entity.context ?? {},
      createdAt: entity.createdAt,
    };
  }
}
