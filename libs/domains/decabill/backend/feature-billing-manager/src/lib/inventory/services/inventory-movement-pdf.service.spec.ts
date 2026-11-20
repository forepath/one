import { InventoryMovementReason, InventoryMovementType } from '../constants/inventory.constants';
import type { InventoryMovementEntity } from '../entities/inventory-movement.entity';

import { buildInventoryMovementStorageKey, InventoryMovementPdfService } from './inventory-movement-pdf.service';

function movement(overrides: Partial<InventoryMovementEntity> = {}): InventoryMovementEntity {
  return {
    id: 'm1',
    tenantId: 'default',
    type: InventoryMovementType.TRANSFER,
    documentNumber: 'TRF-2026-00007',
    numberScope: '__shared__',
    articleId: 'a1',
    quantity: '3.000',
    reason: null,
    sourceCompartmentId: 'c1',
    targetCompartmentId: 'c2',
    sourceQuantityAfter: '2.000',
    targetQuantityAfter: '3.000',
    reference: null,
    note: '<b>fragile</b>',
    withdrawalRequestId: null,
    performedByUserId: 'u1',
    pdfStorageKey: null,
    createdAt: new Date('2026-11-17T10:00:00Z'),
    snapshot: {
      article: { articleNumber: 'ART-000001', name: 'Widget', ean: '4006381333931', unit: 'piece' },
      source: {
        warehouseId: 'w1',
        warehouseCode: 'WH1',
        warehouseName: 'Main',
        compartmentId: 'c1',
        compartmentCode: 'A-01',
        compartmentName: null,
      },
      target: {
        warehouseId: 'w2',
        warehouseCode: 'WH2',
        warehouseName: 'Outlet',
        compartmentId: 'c2',
        compartmentCode: 'B-02',
        compartmentName: 'Shelf',
      },
      performedByEmail: 'admin@example.com',
      request: null,
    },
    ...overrides,
  };
}

describe('InventoryMovementPdfService', () => {
  const service = new InventoryMovementPdfService(
    {} as never,
    {} as never,
    {} as never,
    { getConfig: () => ({ name: 'ACME GmbH' }) } as never,
  );

  it('stores documents per movement type and year', () => {
    expect(buildInventoryMovementStorageKey(movement())).toBe('transfers/2026/TRF-2026-00007.pdf');
    expect(
      buildInventoryMovementStorageKey(
        movement({ type: InventoryMovementType.PUTAWAY, documentNumber: 'PUT-2026-00001' }),
      ),
    ).toBe('putaways/2026/PUT-2026-00001.pdf');
  });

  it('sanitizes unexpected characters in the file name', () => {
    expect(buildInventoryMovementStorageKey(movement({ documentNumber: '../x/y' }))).toBe('transfers/2026/.._x_y.pdf');
  });

  it('builds the view model with both barcodes, stock lines and the document id', () => {
    const view = service.buildViewModel(movement(), 'abc1234');

    expect(view.title).toBe('Stock transfer');
    expect(view.companyName).toBe('ACME GmbH');
    expect(view.articleBarcodeSvg).toContain('<svg');
    expect(view.eanBarcodeSvg).toContain('<svg');
    expect(view.stockLines).toEqual([
      { label: 'Remaining in A-01', value: '2 piece' },
      { label: 'Now in B-02', value: '3 piece' },
    ]);
    expect(view.authenticityShortSha).toBe('abc1234');
    // Free text stays raw here; the Handlebars template escapes it (double-stash).
    expect(view.note).toBe('<b>fragile</b>');
  });

  it('labels reasons and omits the EAN barcode when there is none', () => {
    const view = service.buildViewModel(
      movement({
        type: InventoryMovementType.WITHDRAWAL,
        reason: InventoryMovementReason.DAMAGE,
        targetCompartmentId: null,
        targetQuantityAfter: null,
        snapshot: { ...movement().snapshot, target: null, article: { ...movement().snapshot.article, ean: null } },
      }),
    );

    expect(view.reasonLabel).toBe('Damage');
    expect(view.eanBarcodeSvg).toBeNull();
    expect(view.ean).toBe('–');
    expect(view.signatureRight).toBe('Received by');
  });
});
