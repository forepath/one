import type { TaxCategory } from '@forepath/decabill/frontend/data-access-billing-console';

import {
  applyInventoryArticlePrefill,
  hasValidInventoryPosition,
  inventoryPositionPayload,
} from './inventory-line-prefill.util';

const article = (overrides: Record<string, unknown> = {}) => ({
  name: 'Cable CAT7 5m',
  unit: 'piece',
  salesPriceNet: 12.5 as number | null,
  taxCategory: 'reduced' as const,
  ...overrides,
});

describe('applyInventoryArticlePrefill', () => {
  it('prefills price, empty description, empty unit label and tax category', () => {
    const line = { description: '', unitPriceNet: 0, unitLabel: '', taxCategory: 'standard' as TaxCategory };

    applyInventoryArticlePrefill(line, article(), (unit) => `label:${unit}`);

    expect(line).toEqual({
      description: 'Cable CAT7 5m',
      unitPriceNet: 12.5,
      unitLabel: 'label:piece',
      taxCategory: 'reduced',
    });
  });

  it('keeps the price when the article has no sales price', () => {
    const line = { description: '', unitPriceNet: 42, taxCategory: 'standard' as TaxCategory };

    applyInventoryArticlePrefill(line, article({ salesPriceNet: null }));

    expect(line.unitPriceNet).toBe(42);
    expect(line.description).toBe('Cable CAT7 5m');
  });

  it('prefills a zero sales price', () => {
    const line = { description: 'x', unitPriceNet: 42 };

    applyInventoryArticlePrefill(line, article({ salesPriceNet: 0 }));

    expect(line.unitPriceNet).toBe(0);
  });

  it('does not overwrite a description or unit label the user entered', () => {
    const line = { description: 'Custom text', unitPriceNet: 0, unitLabel: 'Stk.' };

    applyInventoryArticlePrefill(line, article());

    expect(line.description).toBe('Custom text');
    expect(line.unitLabel).toBe('Stk.');
  });

  it('does not add a unit label to lines without one (invoice lines)', () => {
    const line: { description: string; unitPriceNet: number; unitLabel?: string } = {
      description: '',
      unitPriceNet: 0,
    };

    applyInventoryArticlePrefill(line, article());

    expect('unitLabel' in line).toBe(false);
  });

  it('leaves the line untouched when the article is cleared', () => {
    const line = { description: 'Kept', unitPriceNet: 9, unitLabel: 'h', taxCategory: 'reduced' as TaxCategory };

    applyInventoryArticlePrefill(line, null);

    expect(line).toEqual({ description: 'Kept', unitPriceNet: 9, unitLabel: 'h', taxCategory: 'reduced' });
  });
});

describe('invoice position helpers', () => {
  it('requires an article on article positions only', () => {
    expect(hasValidInventoryPosition({ positionType: 'standard' })).toBe(true);
    expect(hasValidInventoryPosition({ positionType: 'article', inventoryArticleId: null })).toBe(false);
    expect(hasValidInventoryPosition({ positionType: 'article', inventoryArticleId: 'a1' })).toBe(true);
  });

  it('adds the article id to the payload of article positions only', () => {
    expect(inventoryPositionPayload({ positionType: 'standard', inventoryArticleId: 'stale' })).toEqual({});
    expect(inventoryPositionPayload({ positionType: 'article', inventoryArticleId: 'a1' })).toEqual({
      inventoryArticleId: 'a1',
    });
  });
});
