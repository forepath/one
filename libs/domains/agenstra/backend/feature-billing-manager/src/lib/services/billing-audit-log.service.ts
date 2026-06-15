import { Injectable, Logger } from '@nestjs/common';

import type { BillingAuditLogResponseDto } from '../dto/admin-billing.dto';
import type { BillingAuditLogEntity } from '../entities/billing-audit-log.entity';
import { BillingAuditLogsRepository } from '../repositories/billing-audit-logs.repository';

@Injectable()
export class BillingAuditLogService {
  private readonly logger = new Logger(BillingAuditLogService.name);

  constructor(private readonly auditLogsRepository: BillingAuditLogsRepository) {}

  async log(params: {
    process: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    invoiceId?: string;
    userId?: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    const { process, level, message, invoiceId, userId, correlationId, context } = params;

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
      userId,
      correlationId,
      context: context ?? {},
    });
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

  private mapToResponse(entity: BillingAuditLogEntity): BillingAuditLogResponseDto {
    return {
      id: entity.id,
      process: entity.process,
      level: entity.level,
      message: entity.message,
      invoiceId: entity.invoiceId,
      userId: entity.userId,
      context: entity.context ?? {},
      createdAt: entity.createdAt,
    };
  }
}
