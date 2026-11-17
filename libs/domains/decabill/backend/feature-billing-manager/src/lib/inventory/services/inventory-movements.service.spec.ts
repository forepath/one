import { BadRequestException, ConflictException } from '@nestjs/common';

import {
  InventoryMovementReason,
  InventoryMovementType,
  InventorySerialUnitStatus,
} from '../constants/inventory.constants';

import { InventoryMovementsService } from './inventory-movements.service';

describe('InventoryMovementsService', () => {
  const manager = { query: jest.fn() };
  const dataSource = { transaction: jest.fn((run: (em: unknown) => unknown) => run(manager)) };
  const movementsRepository = {
    insert: jest.fn(async (_em: unknown, dto: Record<string, unknown>) => ({ id: 'm1', ...dto })),
    setPdfStorageKey: jest.fn(),
    findByIdOrThrow: jest.fn(),
  };
  const stockRepository = {
    findPlacement: jest.fn(),
    ensurePlacement: jest.fn(),
    lockPlacements: jest.fn(),
    setQuantity: jest.fn(),
  };
  const articlesRepository = {
    findByIdOrThrow: jest.fn(),
    stockTotalsFor: jest.fn().mockResolvedValue(new Map()),
    lockForBooking: jest.fn(),
  };
  const serialUnits = {
    lockForArticle: jest.fn().mockResolvedValue(new Map()),
    insertInStock: jest.fn(async (_em: unknown, _article: string, serials: string[]) => serials.length),
    updateUnits: jest.fn(),
  };
  const compartmentsRepository = { findByIdOrThrow: jest.fn() };
  const numberSequences = { nextDocumentNumber: jest.fn() };
  const pdfService = { generateAndStore: jest.fn().mockResolvedValue('putaways/2026/PUT-2026-00001.pdf') };
  const usersRepository = { findByIdForTenant: jest.fn().mockResolvedValue({ email: 'admin@example.com' }) };
  const realtime = {
    movementCreated: jest.fn(),
    locationsChanged: jest.fn(),
    placementsChanged: jest.fn(),
    articlesChanged: jest.fn().mockResolvedValue([]),
    serialUnitsChanged: jest.fn(),
  };
  const auditLog = { log: jest.fn() };
  const notifications = { publish: jest.fn() };
  const service = new InventoryMovementsService(
    dataSource as never,
    movementsRepository as never,
    stockRepository as never,
    articlesRepository as never,
    compartmentsRepository as never,
    numberSequences as never,
    serialUnits as never,
    pdfService as never,
    usersRepository as never,
    realtime as never,
    auditLog as never,
    notifications as never,
  );
  const article = { id: 'a1', articleNumber: 'ART-000001', name: 'Widget', ean: null, unit: 'piece', isActive: true };
  const warehouse = { id: 'w1', code: 'WH1', name: 'Main', isActive: true };
  const compartmentA = { id: 'cA', code: 'A-01', name: null, isActive: true, warehouseId: 'w1', warehouse };
  const compartmentB = { id: 'cB', code: 'B-01', name: null, isActive: true, warehouseId: 'w1', warehouse };

  beforeEach(() => {
    jest.clearAllMocks();
    articlesRepository.findByIdOrThrow.mockResolvedValue(article);
    articlesRepository.lockForBooking.mockResolvedValue({ serialTracking: false });
    serialUnits.lockForArticle.mockResolvedValue(new Map());
    compartmentsRepository.findByIdOrThrow.mockImplementation(async (id: string) =>
      id === 'cA' ? compartmentA : compartmentB,
    );
    numberSequences.nextDocumentNumber.mockImplementation(async (prefix: string, year: number) => ({
      number: `${prefix}-${year}-00001`,
      numberScope: '__shared__',
    }));
  });

  it('books a putaway: adds to the target placement and allocates a PUT number in the transaction', async () => {
    stockRepository.ensurePlacement.mockResolvedValue('sB');
    stockRepository.lockPlacements.mockResolvedValue(new Map([['sB', { id: 'sB', quantity: 1.5 }]]));

    const result = await service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 2.25 }, 'u1');

    expect(stockRepository.setQuantity).toHaveBeenCalledWith(manager, 'sB', 3.75);
    expect(numberSequences.nextDocumentNumber).toHaveBeenCalledWith('PUT', expect.any(Number), manager);
    expect(result).toEqual(
      expect.objectContaining({
        type: InventoryMovementType.PUTAWAY,
        quantity: 2.25,
        targetQuantityAfter: 3.75,
        reason: InventoryMovementReason.RECEIPT,
        performedByEmail: 'admin@example.com',
      }),
    );
    expect(pdfService.generateAndStore).toHaveBeenCalled();
    expect(notifications.publish).toHaveBeenCalledWith('inventory_movement.created', expect.any(Object));
    expect(realtime.movementCreated).toHaveBeenCalled();
  });

  it('refuses to withdraw more than the compartment holds', async () => {
    stockRepository.findPlacement.mockResolvedValue({ id: 'sA' });
    stockRepository.lockPlacements.mockResolvedValue(new Map([['sA', { id: 'sA', quantity: 1 }]]));

    await expect(service.withdraw({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1.001 })).rejects.toThrow(
      BadRequestException,
    );
    expect(stockRepository.setQuantity).not.toHaveBeenCalled();
    expect(movementsRepository.insert).not.toHaveBeenCalled();
  });

  it('refuses a withdrawal from a compartment that does not hold the article', async () => {
    stockRepository.findPlacement.mockResolvedValue(null);

    await expect(service.withdraw({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1 })).rejects.toThrow(
      /not stored/,
    );
  });

  it('transfers between compartments and locks both placements', async () => {
    stockRepository.findPlacement.mockResolvedValue({ id: 'sA' });
    stockRepository.ensurePlacement.mockResolvedValue('sB');
    stockRepository.lockPlacements.mockResolvedValue(
      new Map([
        ['sA', { id: 'sA', quantity: 5 }],
        ['sB', { id: 'sB', quantity: 0 }],
      ]),
    );

    const result = await service.transfer({
      articleId: 'a1',
      sourceCompartmentId: 'cA',
      targetCompartmentId: 'cB',
      quantity: 0.3,
    });

    expect(stockRepository.lockPlacements).toHaveBeenCalledWith(manager, ['sA', 'sB']);
    expect(stockRepository.setQuantity).toHaveBeenCalledWith(manager, 'sA', 4.7);
    expect(stockRepository.setQuantity).toHaveBeenCalledWith(manager, 'sB', 0.3);
    expect(result.sourceQuantityAfter).toBe(4.7);
    expect(result.targetQuantityAfter).toBe(0.3);
  });

  it('rejects transfers into the same compartment', async () => {
    await expect(
      service.transfer({ articleId: 'a1', sourceCompartmentId: 'cA', targetCompartmentId: 'cA', quantity: 1 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects putaways of inactive articles and into inactive compartments', async () => {
    articlesRepository.findByIdOrThrow.mockResolvedValueOnce({ ...article, isActive: false });

    await expect(service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1 })).rejects.toThrow(
      /inactive/,
    );

    compartmentsRepository.findByIdOrThrow.mockResolvedValueOnce({ ...compartmentB, isActive: false });

    await expect(service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1 })).rejects.toThrow(
      /inactive/,
    );
  });

  it('keeps the movement when archiving the document fails (the PDF endpoint regenerates it)', async () => {
    stockRepository.ensurePlacement.mockResolvedValue('sB');
    stockRepository.lockPlacements.mockResolvedValue(new Map([['sB', { id: 'sB', quantity: 0 }]]));
    pdfService.generateAndStore.mockRejectedValueOnce(new Error('renderer down'));

    await expect(service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1 })).resolves.toEqual(
      expect.objectContaining({ hasPdf: false }),
    );
    expect(movementsRepository.setPdfStorageKey).not.toHaveBeenCalled();
  });

  it('publishes a low-stock webhook when a withdrawal crosses the reorder point', async () => {
    stockRepository.findPlacement.mockResolvedValue({ id: 'sA' });
    stockRepository.lockPlacements.mockResolvedValue(new Map([['sA', { id: 'sA', quantity: 10 }]]));
    articlesRepository.stockTotalsFor.mockResolvedValueOnce(new Map([['a1', { totalQuantity: 10, locationCount: 1 }]]));
    realtime.articlesChanged.mockResolvedValueOnce([
      { id: 'a1', articleNumber: 'ART-000001', name: 'Widget', totalQuantity: 4, reorderPoint: 5, reorderQuantity: 20 },
    ]);

    await service.withdraw({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 6 });

    expect(notifications.publish).toHaveBeenCalledWith(
      'article.low_stock',
      expect.objectContaining({ totalQuantity: 4, reorderPoint: 5 }),
    );
  });

  describe('serial numbers', () => {
    const unit = (serialNumber: string, status: InventorySerialUnitStatus, extra: Record<string, unknown> = {}) => [
      serialNumber,
      { id: `u-${serialNumber}`, serialNumber, status, compartmentId: null, lendingId: null, ...extra },
    ];

    beforeEach(() => {
      articlesRepository.lockForBooking.mockResolvedValue({ serialTracking: true });
    });

    it('puts away ranges as individual units and records them on the movement', async () => {
      stockRepository.ensurePlacement.mockResolvedValue('sB');
      stockRepository.lockPlacements.mockResolvedValue(new Map([['sB', { id: 'sB', quantity: 0 }]]));

      const result = await service.putaway({
        articleId: 'a1',
        targetCompartmentId: 'cB',
        quantity: 4,
        serialNumbers: ['LAP-08..LAP-10', 'X1'],
      });

      expect(result.serialNumbers).toEqual(['LAP-08', 'LAP-09', 'LAP-10', 'X1']);
      expect(serialUnits.insertInStock).toHaveBeenCalledWith(
        manager,
        'a1',
        ['LAP-08', 'LAP-09', 'LAP-10', 'X1'],
        'cB',
        'm1',
      );
      expect(realtime.serialUnitsChanged).toHaveBeenCalledWith(['a1']);
    });

    it('requires one serial number per unit', async () => {
      await expect(
        service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 3, serialNumbers: ['A1..A2'] }),
      ).rejects.toThrow(/must equal the number of serial numbers/);
      await expect(service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1 })).rejects.toThrow(
        /requires serial numbers/,
      );
      await expect(
        service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1.5, serialNumbers: ['A1'] }),
      ).rejects.toThrow(BadRequestException);
      expect(movementsRepository.insert).not.toHaveBeenCalled();
    });

    it('rejects serial numbers for articles without serial tracking', async () => {
      articlesRepository.lockForBooking.mockResolvedValue({ serialTracking: false });

      await expect(
        service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1, serialNumbers: ['A1'] }),
      ).rejects.toThrow(/does not track serial numbers/);
    });

    it('refuses serial numbers that are already in stock or on loan, and brings withdrawn ones back', async () => {
      stockRepository.ensurePlacement.mockResolvedValue('sB');
      stockRepository.lockPlacements.mockResolvedValue(new Map([['sB', { id: 'sB', quantity: 0 }]]));
      serialUnits.lockForArticle.mockResolvedValueOnce(new Map([unit('A1', InventorySerialUnitStatus.LENT)] as never));

      await expect(
        service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1, serialNumbers: ['A1'] }),
      ).rejects.toThrow(ConflictException);
      expect(stockRepository.setQuantity).not.toHaveBeenCalled();

      serialUnits.lockForArticle.mockResolvedValueOnce(
        new Map([unit('A1', InventorySerialUnitStatus.WITHDRAWN)] as never),
      );

      await service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 2, serialNumbers: ['A1', 'A2'] });

      expect(serialUnits.insertInStock).toHaveBeenCalledWith(manager, 'a1', ['A2'], 'cB', 'm1');
      expect(serialUnits.updateUnits).toHaveBeenCalledWith(manager, ['u-A1'], {
        status: InventorySerialUnitStatus.IN_STOCK,
        compartmentId: 'cB',
        lendingId: null,
        lastMovementId: 'm1',
      });
    });

    it('rolls back when a concurrent putaway registered a serial number first', async () => {
      stockRepository.ensurePlacement.mockResolvedValue('sB');
      stockRepository.lockPlacements.mockResolvedValue(new Map([['sB', { id: 'sB', quantity: 0 }]]));
      serialUnits.insertInStock.mockResolvedValueOnce(0);

      await expect(
        service.putaway({ articleId: 'a1', targetCompartmentId: 'cB', quantity: 1, serialNumbers: ['A1'] }),
      ).rejects.toThrow(/concurrently/);
    });

    it('moves only units that are in stock in the source compartment, naming the ones that are not', async () => {
      stockRepository.findPlacement.mockResolvedValue({ id: 'sA' });
      stockRepository.ensurePlacement.mockResolvedValue('sB');
      stockRepository.lockPlacements.mockResolvedValue(
        new Map([
          ['sA', { id: 'sA', quantity: 5 }],
          ['sB', { id: 'sB', quantity: 0 }],
        ]),
      );
      serialUnits.lockForArticle.mockResolvedValue(
        new Map([
          unit('A1', InventorySerialUnitStatus.IN_STOCK, { compartmentId: 'cA' }),
          unit('A2', InventorySerialUnitStatus.IN_STOCK, { compartmentId: 'cB' }),
          unit('A3', InventorySerialUnitStatus.WITHDRAWN),
        ] as never),
      );

      await expect(
        service.transfer({
          articleId: 'a1',
          sourceCompartmentId: 'cA',
          targetCompartmentId: 'cB',
          quantity: 4,
          serialNumbers: ['A1..A4'],
        }),
      ).rejects.toThrow('Serial numbers not in stock in A-01: A2, A3, A4');
      expect(stockRepository.setQuantity).not.toHaveBeenCalled();

      await service.transfer({
        articleId: 'a1',
        sourceCompartmentId: 'cA',
        targetCompartmentId: 'cB',
        quantity: 1,
        serialNumbers: ['A1'],
      });

      expect(serialUnits.updateUnits).toHaveBeenCalledWith(manager, ['u-A1'], {
        status: InventorySerialUnitStatus.IN_STOCK,
        compartmentId: 'cB',
        lendingId: null,
        lastMovementId: 'm1',
      });
    });

    it('withdraws and lends units out of stock; returns only accept units of that lending', async () => {
      stockRepository.findPlacement.mockResolvedValue({ id: 'sA' });
      stockRepository.lockPlacements.mockResolvedValue(new Map([['sA', { id: 'sA', quantity: 2 }]]));
      serialUnits.lockForArticle.mockResolvedValue(
        new Map([unit('A1', InventorySerialUnitStatus.IN_STOCK, { compartmentId: 'cA' })] as never),
      );

      await service.book(manager as never, {
        type: InventoryMovementType.LENDING,
        articleId: 'a1',
        quantity: 1,
        sourceCompartmentId: 'cA',
        serialNumbers: ['A1'],
        lendingId: 'l1',
      });

      expect(serialUnits.updateUnits).toHaveBeenLastCalledWith(manager, ['u-A1'], {
        status: InventorySerialUnitStatus.LENT,
        compartmentId: null,
        lendingId: 'l1',
        lastMovementId: 'm1',
      });

      await service.withdraw({ articleId: 'a1', sourceCompartmentId: 'cA', quantity: 1, serialNumbers: ['A1'] });

      expect(serialUnits.updateUnits).toHaveBeenLastCalledWith(manager, ['u-A1'], {
        status: InventorySerialUnitStatus.WITHDRAWN,
        compartmentId: null,
        lendingId: null,
        lastMovementId: 'm1',
      });

      stockRepository.ensurePlacement.mockResolvedValue('sB');
      stockRepository.lockPlacements.mockResolvedValue(new Map([['sB', { id: 'sB', quantity: 0 }]]));
      serialUnits.lockForArticle.mockResolvedValue(
        new Map([unit('A1', InventorySerialUnitStatus.LENT, { lendingId: 'other' })] as never),
      );

      await expect(
        service.book(manager as never, {
          type: InventoryMovementType.LENDING_RETURN,
          articleId: 'a1',
          quantity: 1,
          targetCompartmentId: 'cB',
          serialNumbers: ['A1'],
          lendingId: 'l1',
        }),
      ).rejects.toThrow('Serial numbers not on this lending: A1');
    });
  });
});
