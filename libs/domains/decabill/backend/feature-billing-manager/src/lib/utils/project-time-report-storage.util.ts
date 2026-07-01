import * as path from 'path';

import type { InvoiceEntity } from '../entities/invoice.entity';

export function buildProjectTimeReportStorageKey(
  invoice: Pick<InvoiceEntity, 'id' | 'subscriptionId' | 'userId'>,
): string {
  const fileName = `${invoice.id}-time-report.pdf`;
  const folder = invoice.subscriptionId?.trim() || path.join('manual', invoice.userId);

  return path.join(folder, fileName);
}
