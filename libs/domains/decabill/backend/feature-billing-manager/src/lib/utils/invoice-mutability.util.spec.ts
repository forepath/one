import { BadRequestException } from '@nestjs/common';

import { InvoiceStatus } from '../constants/invoice-status.constants';
import type { InvoiceEntity } from '../entities/invoice.entity';

import { assertDraftEditable } from './invoice-mutability.util';

describe('assertDraftEditable', () => {
  const draft = { status: InvoiceStatus.DRAFT } as InvoiceEntity;

  it('allows draft invoices', () => {
    expect(() => assertDraftEditable(draft)).not.toThrow();
  });

  it('rejects issued invoices', () => {
    expect(() => assertDraftEditable({ status: InvoiceStatus.ISSUED } as InvoiceEntity)).toThrow(BadRequestException);
  });
});
