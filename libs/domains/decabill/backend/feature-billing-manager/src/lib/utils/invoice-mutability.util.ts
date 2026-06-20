import { BadRequestException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

export function assertDraftEditable(invoice: InvoiceEntity): void {
  if (invoice.status !== InvoiceStatus.DRAFT) {
    throw new BadRequestException('Only draft invoices can be modified');
  }
}
