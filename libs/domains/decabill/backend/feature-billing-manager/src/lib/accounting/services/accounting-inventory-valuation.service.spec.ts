import { InventoryMovementReason, InventoryMovementType } from '../../inventory/constants/inventory.constants';
import { InventoryArticleEntity } from '../../inventory/entities/inventory-article.entity';
import { InventoryMovementEntity } from '../../inventory/entities/inventory-movement.entity';
import { AccountingAccountRole as R, JournalEntryKind, JournalSourceType } from '../constants/accounting.constants';

import { AccountingInventoryValuationService } from './accounting-inventory-valuation.service';
import type { PostEntryInput } from './accounting-journal.service';

describe('AccountingInventoryValuationService', () => {
  let article: Record<string, unknown>;
  let movements: Record<string, Record<string, unknown>>;
  let stockAfter: number;
  let invoiceLinePrice: string | null;
  let invoiceCurrency = 'EUR';
  const articleRepo = {
    findOneOrFail: jest.fn(async () => article),
    update: jest.fn(async (_id: string, _patch: Record<string, unknown>) => undefined),
  };
  const movementRepo = {
    findOneOrFail: jest.fn(async ({ where }: { where: { id: string } }) => movements[where.id]),
    update: jest.fn(async (_id: string, _patch: Record<string, unknown>) => undefined),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === InventoryArticleEntity ? articleRepo : entity === InventoryMovementEntity ? movementRepo : null,
    ),
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('billing_inventory_stock')) {
        return [{ total: String(stockAfter) }];
      }

      if (sql.includes('billing_supplier_invoice_line_items')) {
        return invoiceLinePrice === null
          ? []
          : [{ price: invoiceLinePrice, currency: invoiceCurrency, issue_date: '2026-03-01', issued_at: null }];
      }

      return [];
    }),
  };
  const posting: { inventoryHandler?: (manager: never, movementId: string) => Promise<PostEntryInput | null> } = {};
  const charts = { requireAccountByRole: jest.fn(async (_chart: string, role: R) => ({ id: `acc-${role}` })) };
  const fiscalYears = { resolvePostingTarget: jest.fn(async () => ({ fiscalYear: { chartId: 'c1' } })) };
  const port = { onInventoryMovementBooked: jest.fn(async () => undefined) };
  const fx = { convert: jest.fn(async (_a: number, currency: string) => ({ rate: currency === 'USD' ? 1.25 : 1 })) };
  const service = new AccountingInventoryValuationService(
    posting as never,
    charts as never,
    fiscalYears as never,
    port as never,
    fx as never,
  );
  const movement = (overrides: Record<string, unknown> = {}) => ({
    id: 'mv-1',
    tenantId: 'acme',
    articleId: 'art-1',
    documentNumber: 'PUT-2026-00001',
    type: InventoryMovementType.PUTAWAY,
    reason: InventoryMovementReason.RECEIPT,
    quantity: '10',
    snapshot: { article: { name: 'Widget' } },
    createdAt: new Date('2026-03-10T10:00:00Z'),
    ...overrides,
  });
  const book = async (mv: Record<string, unknown>, params: Record<string, unknown> = {}) =>
    await service.onMovementBooked(
      manager as never,
      mv as never,
      { type: mv['type'], articleId: 'art-1', quantity: Number(mv['quantity']), ...params } as never,
    );
  const movementPatch = () => movementRepo.update.mock.calls[0][1];
  const newAverage = () => articleRepo.update.mock.calls[0]?.[1]['averageCost'];

  beforeEach(() => {
    jest.clearAllMocks();
    article = { id: 'art-1', averageCost: '5.0000', purchasePriceNet: '7.00' };
    movements = {};
    stockAfter = 20;
    invoiceLinePrice = null;
  });

  describe('moving average on receipts', () => {
    it('blends the supplier invoice line price into the average and values the movement', async () => {
      invoiceLinePrice = '8.00';

      await book(movement(), { supplierInvoiceId: 'si-1' });

      // (10 × 5 + 10 × 8) / 20
      expect(newAverage()).toBe(6.5);
      expect(movementPatch()).toEqual({ unitCost: 8, totalCost: 80, supplierInvoiceId: 'si-1' });
      expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('billing_supplier_invoice_line_items'), [
        'si-1',
        'art-1',
      ]);
      expect(port.onInventoryMovementBooked).toHaveBeenCalledWith(manager, 'mv-1');
    });

    it('converts a foreign-currency invoice line price at the invoice rate', async () => {
      invoiceLinePrice = '10.00';
      invoiceCurrency = 'USD';

      try {
        await book(movement(), { supplierInvoiceId: 'si-1' });

        expect(fx.convert).toHaveBeenCalledWith(1, 'USD', '2026-03-01', manager);
        expect(movementPatch()).toEqual({ unitCost: 8, totalCost: 80, supplierInvoiceId: 'si-1' });
      } finally {
        invoiceCurrency = 'EUR';
      }
    });

    it('prefers an explicit unit cost over the invoice line price', async () => {
      invoiceLinePrice = '8.00';

      await book(movement(), { supplierInvoiceId: 'si-1', unitCost: 6 });

      expect(newAverage()).toBe(5.5);
      expect(movementPatch()).toEqual(expect.objectContaining({ unitCost: 6, totalCost: 60 }));
      expect(manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('billing_supplier_invoice_line_items'),
        expect.anything(),
      );
    });

    it('falls back to the article purchase price without an invoice price', async () => {
      await book(movement(), { supplierInvoiceId: 'si-1' });

      // invoice has no line for the article → purchase price 7: (10 × 5 + 10 × 7) / 20
      expect(newAverage()).toBe(6);
      expect(movementPatch()).toEqual(expect.objectContaining({ unitCost: 7, totalCost: 70 }));
    });

    it('takes the receipt price as the new average when the article had no stock', async () => {
      stockAfter = 10;

      await book(movement(), { unitCost: 9.99 });

      expect(newAverage()).toBe(9.99);
    });

    it('does not divide by zero when stock is still zero or negative after the receipt', async () => {
      stockAfter = -5;

      await book(movement({ quantity: '3' }), { unitCost: 4 });

      expect(newAverage()).toBe(4);
      expect(movementPatch()).toEqual(expect.objectContaining({ unitCost: 4, totalCost: 12 }));
    });

    it('values customer returns at the current average (average unchanged)', async () => {
      await book(movement({ reason: InventoryMovementReason.RETURN }));

      expect(newAverage()).toBe(5);
      expect(movementPatch()).toEqual(expect.objectContaining({ unitCost: 5, totalCost: 50 }));
    });

    it('starts from the purchase price when the article has no average yet', async () => {
      article = { id: 'art-1', averageCost: null, purchasePriceNet: '2.50' };
      stockAfter = 4;

      await book(
        movement({
          type: InventoryMovementType.WITHDRAWAL,
          reason: InventoryMovementReason.FULFILLMENT,
          quantity: '2',
        }),
      );

      expect(articleRepo.update).not.toHaveBeenCalled();
      expect(movementPatch()).toEqual({ unitCost: 2.5, totalCost: 5, supplierInvoiceId: null });
    });
  });

  describe('withdrawals', () => {
    it('leave at the current average without touching it', async () => {
      stockAfter = 7;

      await book(
        movement({
          type: InventoryMovementType.WITHDRAWAL,
          reason: InventoryMovementReason.FULFILLMENT,
          quantity: '3',
        }),
      );

      expect(articleRepo.update).not.toHaveBeenCalled();
      expect(movementPatch()).toEqual({ unitCost: 5, totalCost: 15, supplierInvoiceId: null });
    });

    it('do not fail without an accounting posting port', async () => {
      const standalone = new AccountingInventoryValuationService(
        posting as never,
        charts as never,
        fiscalYears as never,
      );

      await expect(
        standalone.onMovementBooked(
          manager as never,
          movement({ type: InventoryMovementType.WITHDRAWAL }) as never,
          {} as never,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('postings (registered as the posting service inventory handler)', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    const build = async (mv: Record<string, unknown>) => {
      movements[String(mv['id'])] = mv;

      return await posting.inventoryHandler!(manager as never, String(mv['id']));
    };

    it('books a withdrawal as cost of goods sold against inventory', async () => {
      const entry = await build(
        movement({
          type: InventoryMovementType.WITHDRAWAL,
          reason: InventoryMovementReason.FULFILLMENT,
          documentNumber: 'WDR-2026-00003',
          totalCost: '15.004',
        }),
      );

      expect(fiscalYears.resolvePostingTarget).toHaveBeenCalledWith('2026-03-10', manager);
      expect(entry).toEqual(
        expect.objectContaining({
          documentDate: '2026-03-10',
          documentNumber: 'WDR-2026-00003',
          kind: JournalEntryKind.AUTOMATIC,
          sourceType: JournalSourceType.INVENTORY_MOVEMENT,
          sourceId: 'mv-1',
          sourceEvent: 'booked',
          tenantId: 'acme',
          description: 'Stock withdrawal WDR-2026-00003 (Widget)',
        }),
      );
      expect(entry!.lines).toEqual([
        { accountId: `acc-${R.COST_OF_GOODS_SOLD}`, debit: 15, tenantId: 'acme' },
        { accountId: `acc-${R.INVENTORY}`, credit: 15, tenantId: 'acme' },
      ]);
    });

    it('books returns and count corrections back into inventory', async () => {
      const entry = await build(movement({ reason: InventoryMovementReason.RETURN, totalCost: '50' }));

      expect(entry!.lines).toEqual([
        { accountId: `acc-${R.INVENTORY}`, debit: 50, tenantId: 'acme' },
        { accountId: `acc-${R.COST_OF_GOODS_SOLD}`, credit: 50, tenantId: 'acme' },
      ]);
      await expect(
        build(movement({ id: 'mv-2', reason: InventoryMovementReason.CORRECTION, totalCost: '4' })),
      ).resolves.not.toBeNull();
      // Found / initial stock (reason OTHER) changes the average, so it must reach the inventory account too.
      await expect(
        build(movement({ id: 'mv-3', reason: InventoryMovementReason.OTHER, totalCost: '12' })),
      ).resolves.toEqual(
        expect.objectContaining({
          lines: expect.arrayContaining([{ accountId: `acc-${R.INVENTORY}`, debit: 12, tenantId: 'acme' }]),
        }),
      );
    });

    it('books nothing for receipts (capitalized by the supplier invoice), transfers and zero-value movements', async () => {
      await expect(build(movement({ totalCost: '80' }))).resolves.toBeNull();
      await expect(
        build(movement({ id: 'mv-t', type: InventoryMovementType.TRANSFER, reason: null, totalCost: '80' })),
      ).resolves.toBeNull();
      await expect(
        build(movement({ id: 'mv-0', type: InventoryMovementType.WITHDRAWAL, totalCost: '0.004' })),
      ).resolves.toBeNull();
      await expect(
        build(movement({ id: 'mv-n', type: InventoryMovementType.WITHDRAWAL, totalCost: null })),
      ).resolves.toBeNull();

      expect(charts.requireAccountByRole).not.toHaveBeenCalled();
    });
  });
});
