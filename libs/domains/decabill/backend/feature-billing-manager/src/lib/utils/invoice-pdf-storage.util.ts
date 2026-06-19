import * as path from 'path';

import type { InvoiceEntity } from '../entities/invoice.entity';

export function buildInvoicePdfStorageKey(
  invoice: Pick<InvoiceEntity, 'id' | 'subscriptionId' | 'userId'>,
  fileSuffix: string,
): string {
  const fileName = `${invoice.id}${fileSuffix}`;
  const folder = invoice.subscriptionId?.trim() || path.join('manual', invoice.userId);

  return path.join(folder, fileName);
}
