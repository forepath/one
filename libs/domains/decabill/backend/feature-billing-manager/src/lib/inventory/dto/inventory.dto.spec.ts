import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { InventoryMovementReason } from '../constants/inventory.constants';

import {
  AcceptInventoryWithdrawalRequestDto,
  CreateInventoryArticleDto,
  CreateInventoryLendingDto,
  CreateInventoryWarehouseDto,
  InventoryPutawayDto,
  InventoryTransferDto,
  InventoryWithdrawalDto,
  PrintInventoryLabelsDto,
  ReturnInventoryLendingDto,
} from './inventory.dto';

const UUID = '6f9619ff-8b86-4011-b42d-00c04fc964ff';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });

  return errors.map((error) => error.property);
}

describe('inventory DTOs', () => {
  it('accepts a valid EAN-13 and normalizes spaces', async () => {
    const dto = plainToInstance(CreateInventoryArticleDto, { name: 'Widget', ean: '400 6381 333931' });

    expect(await validate(dto)).toEqual([]);
    expect(dto.ean).toBe('4006381333931');
  });

  it('rejects an EAN with a wrong check digit', async () => {
    expect(await errorsOf(CreateInventoryArticleDto, { name: 'Widget', ean: '4006381333932' })).toEqual(['ean']);
  });

  it('clears an empty EAN to null', async () => {
    const dto = plainToInstance(CreateInventoryArticleDto, { name: 'Widget', ean: '' });

    expect(await validate(dto)).toEqual([]);
    expect(dto.ean).toBeNull();
  });

  it('rejects unknown units and custom tax categories', async () => {
    expect(await errorsOf(CreateInventoryArticleDto, { name: 'W', unit: 'bucket', taxCategory: 'custom' })).toEqual([
      'unit',
      'taxCategory',
    ]);
  });

  it('accepts empty (null) prices: nothing is prefilled', async () => {
    expect(
      await errorsOf(CreateInventoryArticleDto, { name: 'W', purchasePriceNet: null, salesPriceNet: null }),
    ).toEqual([]);
  });

  it('rejects negative prices', async () => {
    expect(await errorsOf(CreateInventoryArticleDto, { name: 'W', salesPriceNet: -1 })).toEqual(['salesPriceNet']);
  });

  it('requires positive quantities with at most three decimals', async () => {
    expect(await errorsOf(InventoryPutawayDto, { articleId: UUID, targetCompartmentId: UUID, quantity: 0 })).toEqual([
      'quantity',
    ]);
    expect(
      await errorsOf(InventoryPutawayDto, { articleId: UUID, targetCompartmentId: UUID, quantity: 1.0001 }),
    ).toEqual(['quantity']);
    expect(
      await errorsOf(InventoryPutawayDto, { articleId: UUID, targetCompartmentId: UUID, quantity: '2.5' }),
    ).toEqual([]);
  });

  it('does not let direct withdrawals claim the fulfilment reason', async () => {
    expect(
      await errorsOf(InventoryWithdrawalDto, {
        articleId: UUID,
        sourceCompartmentId: UUID,
        quantity: 1,
        reason: InventoryMovementReason.FULFILLMENT,
      }),
    ).toEqual(['reason']);
  });

  it('rejects codes with markup characters and unknown fields', async () => {
    expect(await errorsOf(CreateInventoryWarehouseDto, { code: '<script>', name: 'Main' })).toEqual(['code']);
    expect(await errorsOf(CreateInventoryWarehouseDto, { code: 'WH-1', name: 'Main', tenantId: 'acme' })).toEqual([
      'tenantId',
    ]);
  });

  it('requires at least one allocation when accepting a request', async () => {
    expect(await errorsOf(AcceptInventoryWithdrawalRequestDto, { allocations: [] })).toEqual(['allocations']);
  });

  describe('serial numbers', () => {
    it('accepts singles and ranges on every movement', async () => {
      expect(
        await errorsOf(InventoryPutawayDto, {
          articleId: UUID,
          targetCompartmentId: UUID,
          quantity: 4,
          serialNumbers: ['LAP-01..LAP-03', 'X1'],
        }),
      ).toEqual([]);
      expect(
        await errorsOf(InventoryTransferDto, {
          articleId: UUID,
          sourceCompartmentId: UUID,
          targetCompartmentId: UUID,
          quantity: 1,
          serialNumbers: ['X1'],
        }),
      ).toEqual([]);
      expect(
        await errorsOf(AcceptInventoryWithdrawalRequestDto, {
          allocations: [{ compartmentId: UUID, quantity: 2, serialNumbers: ['A1, A2'] }],
        }),
      ).toEqual([]);
    });

    it('rejects invalid serial numbers, bad ranges, duplicates and oversized ranges with a readable message', async () => {
      for (const serialNumbers of [['<b>'], ['A9..A1'], ['A1..B3'], ['A1', 'A1'], ['A1..A5000'], 'A1', [1]]) {
        expect(
          await errorsOf(InventoryWithdrawalDto, {
            articleId: UUID,
            sourceCompartmentId: UUID,
            quantity: 1,
            serialNumbers,
          }),
        ).toEqual(['serialNumbers']);
      }

      const [error] = await validate(
        plainToInstance(InventoryWithdrawalDto, {
          articleId: UUID,
          sourceCompartmentId: UUID,
          quantity: 1,
          serialNumbers: ['A9..A1'],
        }),
      );

      expect(Object.values(error?.constraints ?? {}).join()).toContain('A9..A1 (range must count upwards)');
    });
  });

  describe('lendings', () => {
    it('validates borrower, due date and quantities', async () => {
      expect(
        await errorsOf(CreateInventoryLendingDto, {
          articleId: UUID,
          sourceCompartmentId: UUID,
          quantity: 1,
          borrowerName: '  Jane Doe ',
          dueDate: '2030-01-31',
        }),
      ).toEqual([]);
      expect(
        await errorsOf(CreateInventoryLendingDto, {
          articleId: UUID,
          sourceCompartmentId: UUID,
          quantity: 0,
          borrowerUserId: 'not-a-uuid',
          dueDate: '31.01.2030',
        }),
      ).toEqual(['quantity', 'borrowerUserId', 'dueDate']);
      expect(await errorsOf(ReturnInventoryLendingDto, { targetCompartmentId: UUID, quantity: 1 })).toEqual([]);
      expect((await errorsOf(ReturnInventoryLendingDto, { quantity: 1, extra: true })).sort()).toEqual([
        'extra',
        'targetCompartmentId',
      ]);
    });
  });

  describe('labels', () => {
    it('accepts known kinds and layouts only', async () => {
      expect(
        await errorsOf(PrintInventoryLabelsDto, {
          kinds: ['article_number', 'property'],
          articleIds: [UUID],
          copies: 2,
          layout: 'single',
        }),
      ).toEqual([]);
      expect(
        await errorsOf(PrintInventoryLabelsDto, {
          kinds: ['qr', 'ean', 'ean'],
          articleIds: ['x'],
          copies: 21,
          layout: 'roll',
        }),
      ).toEqual(['kinds', 'articleIds', 'copies', 'layout']);
      expect(await errorsOf(PrintInventoryLabelsDto, { kinds: [] })).toEqual(['kinds']);
    });
  });
});
