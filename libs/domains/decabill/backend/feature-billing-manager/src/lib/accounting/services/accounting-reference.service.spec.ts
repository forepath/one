import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AccountingReferenceService } from './accounting-reference.service';

const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('AccountingReferenceService', () => {
  let query: jest.Mock;
  let service: AccountingReferenceService;

  beforeEach(() => {
    query = jest.fn(async () => []);
    service = new AccountingReferenceService({ manager: { query } } as never);
  });

  it('labels references by type in one query per type and skips unknown types and non-ids', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('billing_invoices d')
        ? [{ id: INVOICE_ID, label: 'INV-2026-00001' }]
        : [{ id: USER_ID, label: 'Acme GmbH (CUS-000001)' }],
    );

    const labels = await service.labels([
      { type: 'invoice', id: INVOICE_ID },
      { type: 'invoice', id: INVOICE_ID },
      { type: 'customer', id: USER_ID },
      { type: 'processor_transaction', id: 'txn_123' },
      { type: 'invoice', id: null },
      { type: 'nonsense', id: INVOICE_ID },
    ]);

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][1]).toEqual([[INVOICE_ID]]);
    expect(labels.get(AccountingReferenceService.key('invoice', INVOICE_ID))).toBe('INV-2026-00001');
    expect(labels.get(AccountingReferenceService.key('customer', USER_ID))).toBe('Acme GmbH (CUS-000001)');
    expect(labels.size).toBe(2);
  });

  it('restricts labels to the viewed tenant', async () => {
    await service.labels([{ type: 'invoice', id: INVOICE_ID }], undefined, 'acme');

    expect(query.mock.calls[0][0]).toContain('u.tenant_id = $2');
    expect(query.mock.calls[0][1]).toEqual([[INVOICE_ID], 'acme']);
  });

  it('resolves a typed document number within the tenant', async () => {
    query.mockResolvedValueOnce([{ id: INVOICE_ID }]);

    await expect(service.resolve('invoice', ' inv-2026-00001 ', 'acme')).resolves.toBe(INVOICE_ID);
    expect(query.mock.calls[0][0]).toContain('UPPER(d.invoice_number) = UPPER($1)');
    expect(query.mock.calls[0][1]).toEqual(['inv-2026-00001', 'acme']);
  });

  it('accepts an existing id and falls back to the number lookup for unknown ids', async () => {
    query.mockResolvedValueOnce([{ id: INVOICE_ID }]);
    await expect(service.resolve('invoice', INVOICE_ID, null)).resolves.toBe(INVOICE_ID);

    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.resolve('invoice', USER_ID, null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("treats another tenant's document id as not found", async () => {
    await expect(service.resolve('invoice', INVOICE_ID, 'acme')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0][0]).toContain('d.id = $1::uuid AND u.tenant_id = $2');
    expect(query.mock.calls[0][1]).toEqual([INVOICE_ID, 'acme']);
  });

  it('rejects ambiguous numbers, unknown numbers and empty input', async () => {
    query.mockResolvedValueOnce([{ id: INVOICE_ID }, { id: USER_ID }]);
    await expect(service.resolve('supplier_invoice', 'R-1', null)).rejects.toBeInstanceOf(BadRequestException);

    await expect(service.resolve('offer', 'OFF-404', null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolve('invoice', '  ', null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only finds number-less types by id and passes external ids of table-less types through', async () => {
    await expect(service.resolve('settlement', 'S-1', null)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).not.toHaveBeenCalled();

    await expect(service.resolve('processor_transaction', 'txn_123', null)).resolves.toBe('txn_123');
  });
});
