import { resolvePurchaseOrderReference } from './purchase-order-reference.util';

describe('resolvePurchaseOrderReference', () => {
  it('uses subscription number when available', () => {
    expect(resolvePurchaseOrderReference('SUB-2026-00001', 'sub-uuid')).toBe('SUB-2026-00001');
  });

  it('falls back to subscription id when number is missing', () => {
    expect(resolvePurchaseOrderReference(undefined, 'sub-uuid')).toBe('sub-uuid');
    expect(resolvePurchaseOrderReference('  ', 'sub-uuid')).toBe('sub-uuid');
  });
});
