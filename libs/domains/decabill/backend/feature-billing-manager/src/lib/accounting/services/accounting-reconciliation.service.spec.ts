import { BadRequestException } from '@nestjs/common';

import { DocumentSettlementEntity } from '../../entities/document-settlement.entity';
import { AccountingBankTransactionEntity } from '../entities/accounting-bank-transaction.entity';
import { AccountingFinancialAccountEntity } from '../entities/accounting-financial-account.entity';
import { AccountingJournalEntryEntity } from '../entities/accounting-journal-entry.entity';
import { AccountingMatchRuleEntity } from '../entities/accounting-match-rule.entity';

import { AccountingReconciliationService } from './accounting-reconciliation.service';

describe('AccountingReconciliationService', () => {
  const openInvoices = [
    {
      id: 'inv-1',
      number: 'INV-2026-00042',
      balance: '119.00',
      party: 'u1',
      reference: 'RF18INV2026000423F2A',
      currency: 'EUR',
      name: 'Fischer GmbH',
    },
    {
      id: 'inv-2',
      number: 'INV-2026-00043',
      balance: '50.00',
      party: 'u2',
      reference: null,
      currency: 'EUR',
      name: 'Acme BV',
    },
  ];
  const rules: unknown[] = [];
  let previousSettlements: Array<Record<string, unknown>> = [];
  let previousDirectEntries = 0;
  let txRow: Record<string, unknown>;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const txRepo = {
    findOne: jest.fn(async () => txRow),
    update: jest.fn(),
    createQueryBuilder: () => {
      const qb = { where: () => qb, setLock: () => qb, getOne: async () => txRow };

      return qb;
    },
    findOneOrFail: jest.fn(async () => txRow),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === AccountingBankTransactionEntity
        ? txRepo
        : entity === AccountingFinancialAccountEntity
          ? { findOneOrFail: async () => ({ id: 'fa-1', ledgerAccountNumber: '1200', tenantId: 'acme' }) }
          : entity === DocumentSettlementEntity
            ? { find: async () => previousSettlements }
            : entity === AccountingJournalEntryEntity
              ? {
                  createQueryBuilder: () => {
                    const qb = { where: () => qb, getCount: async () => previousDirectEntries };

                    return qb;
                  },
                }
              : { find: async () => rules },
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });

      return sql.includes('JOIN users') ? [{ tenant_id: params[0] === 'inv-foreign' ? 'other' : 'acme' }] : [];
    }),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });

      return sql.includes('FROM billing_invoices') ? openInvoices : [];
    }),
    getRepository: (entity: unknown) => manager.getRepository(entity),
    transaction: async (run: (m: unknown) => unknown) => await run(manager),
  };
  const config = { getConfig: () => ({ autoMatchThreshold: 0.9 }), isEnabled: () => true };
  const settlements = { apply: jest.fn() };
  const service = new AccountingReconciliationService(
    dataSource as never,
    config as never,
    settlements as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const baseTx = {
    id: 'bt-1',
    financialAccountId: 'fa-1',
    tenantId: 'acme',
    status: 'booked',
    bookingDate: '2026-03-12',
    valueDate: '2026-03-12',
    amount: '119.00',
    currency: 'EUR',
    matchStatus: 'unmatched',
    remittance: null,
    endToEndId: null,
    structuredReference: null,
    counterpartyName: null,
    counterpartyIban: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queries.length = 0;
    txRow = { ...baseTx };
    previousSettlements = [];
    previousDirectEntries = 0;
  });

  it('matches the structured RF reference with full confidence', async () => {
    const [best] = await service.suggest({ ...baseTx, structuredReference: 'RF18INV2026000423F2A' } as never);

    expect(best).toEqual(
      expect.objectContaining({
        score: 1,
        targets: [{ type: 'invoice', id: 'inv-1', number: 'INV-2026-00042', amount: 119 }],
      }),
    );
  });

  it('finds the invoice number inside free remittance text (separators ignored) and penalizes amount mismatches', async () => {
    const [exact] = await service.suggest({ ...baseTx, remittance: 'Rechnung INV 2026/00042 danke' } as never);
    const [partial] = await service.suggest({ ...baseTx, amount: '100.00', remittance: 'INV-2026-00042' } as never);

    expect(exact).toEqual(expect.objectContaining({ score: 0.9 }));
    expect(partial.score).toBeCloseTo(0.75);
  });

  it('restricts document candidates to the bank account tenant', async () => {
    await service.suggest(baseTx as never);

    const invoiceQuery = queries.find((q) => q.sql.includes('FROM billing_invoices'))!;

    expect(invoiceQuery.sql).toContain('u.tenant_id = $2');
    expect(invoiceQuery.params).toEqual(['EUR', 'acme']);
  });

  it('refuses matches whose amounts do not add up or that target another tenant', async () => {
    await expect(
      service.apply('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 100 }], 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.apply('bt-1', [{ type: 'invoice', id: 'inv-foreign', amount: 119 }], 'admin')).rejects.toThrow(
      /another tenant/,
    );
    expect(settlements.apply).not.toHaveBeenCalled();
  });

  it('settles matched invoices with the bank transaction as source', async () => {
    await service.apply('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 119 }], 'admin');

    expect(settlements.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'inv-1',
        type: 'payment',
        amount: 119,
        bankTransactionId: 'bt-1',
        sourceRef: 'bank:bt-1:inv-1',
      }),
      manager,
    );
    expect(txRepo.update).toHaveBeenCalledWith('bt-1', expect.objectContaining({ matchStatus: 'matched' }));
  });

  it('never reconciles a transaction twice', async () => {
    txRow = { ...baseTx, matchStatus: 'matched' };

    await expect(service.apply('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 119 }], 'admin')).rejects.toThrow(
      /already reconciled/,
    );
  });

  it('only matches invoice numbers and payment references as whole tokens', async () => {
    // INV-2026-0004 is a prefix of INV-2026-00042 and must not be suggested for it (and vice versa).
    const shorter = { ...openInvoices[1], id: 'inv-short', number: 'INV-2026-0004', balance: '119.00' };

    openInvoices.push(shorter);

    try {
      const suggestions = await service.suggest({ ...baseTx, remittance: 'INV-2026-00042 thanks' } as never);

      expect(suggestions.map((s) => s.targets[0])).toEqual([expect.objectContaining({ id: 'inv-1' })]);

      const none = await service.suggest({ ...baseTx, remittance: 'Ref RF18INV2026000423F2AX' } as never);

      expect(none.find((s) => s.targets[0].type === 'invoice' && s.targets[0].id === 'inv-1')).toBeUndefined();
    } finally {
      openInvoices.pop();
    }
  });

  it('refuses to reconcile, ignore or unmatch a superseded (replaced / duplicate) line', async () => {
    txRow = { ...baseTx, matchStatus: 'superseded' };

    await expect(service.apply('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 119 }], 'admin')).rejects.toThrow(
      /replaced by or duplicates/,
    );
    await expect(service.ignore('bt-1', 'admin')).rejects.toThrow(/replaced by or duplicates/);
    await expect(service.unmatch('bt-1', 'admin')).rejects.toThrow(/replaced by or duplicates/);
    expect(settlements.apply).not.toHaveBeenCalled();
  });

  it('uses fresh settlement keys when a line is matched again after an unmatch', async () => {
    previousSettlements = [{ id: 's-1', documentId: 'inv-1', bankTransactionId: 'bt-1', reversesSettlementId: null }];

    await service.apply('bt-1', [{ type: 'invoice', id: 'inv-1', amount: 119 }], 'admin');

    expect(settlements.apply).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRef: 'bank:bt-1:inv-1:2' }),
      manager,
    );
  });

  describe('direct bookings', () => {
    const journal = { post: jest.fn(async () => ({ entry: { id: 'je-1' } })) };
    const charts = {
      findAccountByNumber: jest.fn(async (_chart: string, number: string) => ({ id: `acc-${number}`, isActive: true })),
      findTaxCode: jest.fn(async () => null),
    };
    const fiscalYears = { resolvePostingTarget: jest.fn(async () => ({ fiscalYear: { chartId: 'chart-1' } })) };
    const direct = new AccountingReconciliationService(
      dataSource as never,
      config as never,
      settlements as never,
      journal as never,
      charts as never,
      fiscalYears as never,
    );

    it('balances a payment split into an invoice and a fee account (bank line = account targets only)', async () => {
      txRow = { ...baseTx, amount: '100.00' };

      await direct.apply(
        'bt-1',
        [
          { type: 'invoice', id: 'inv-1', amount: 97 },
          { type: 'account', accountNumber: '4970', amount: 3 },
        ],
        'admin',
      );

      const input = (journal.post.mock.calls[0] as unknown[])[0] as {
        lines: Array<{ debit?: number; credit?: number }>;
        idempotencyKey: string;
      };
      const debit = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const credit = input.lines.reduce((s, l) => s + (l.credit ?? 0), 0);

      expect(debit).toBe(3);
      expect(credit).toBe(3);
      expect(input.idempotencyKey).toBe('bank_transaction:bt-1:direct');
      expect(settlements.apply).toHaveBeenCalledWith(expect.objectContaining({ amount: 97 }), manager);
    });

    it('uses a fresh journal key when re-booked after an unmatch', async () => {
      previousDirectEntries = 1;

      await direct.apply('bt-1', [{ type: 'account', accountNumber: '4970', amount: 119 }], 'admin');

      expect(journal.post).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'bank_transaction:bt-1:direct:2' }),
        manager,
      );
    });
  });

  it('rejects learned rules that point at a non-existing target', async () => {
    await expect(
      service.createRule(
        { kind: 'iban', pattern: 'DE89370400440532013000', targetType: 'account', targetId: '9999' },
        'admin',
      ),
    ).rejects.toThrow(/Unknown account 9999/);
    expect(queries.some((q) => q.sql.includes('FROM billing_accounting_accounts') && q.params[0] === '9999')).toBe(
      true,
    );
  });

  it('keeps AccountingMatchRuleEntity import used', () => {
    expect(AccountingMatchRuleEntity).toBeDefined();
  });
});
