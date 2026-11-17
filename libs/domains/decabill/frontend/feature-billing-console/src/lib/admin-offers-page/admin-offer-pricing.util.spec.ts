import type { OfferLineResponse } from '@forepath/decabill/frontend/data-access-billing-console';

import {
  createEmptyOfferFormLine,
  isOfferFormValid,
  mapOfferDetailLinesToForm,
  mapOfferFormLinesToDto,
} from './admin-offer-form.util';
import { computeProjectTemplateOfferLineTotals, computeStandardOfferLineTotals } from './admin-offer-totals.util';

const projectLine = (overrides: Partial<ReturnType<typeof createEmptyOfferFormLine>> = {}) => ({
  ...createEmptyOfferFormLine('project_template'),
  description: 'Website',
  name: 'Website project',
  hourlyRateNet: 100,
  ...overrides,
});

describe('offer project template pricing', () => {
  it('omits pricing fields for hourly lines (unchanged payload)', () => {
    const [dto] = mapOfferFormLinesToDto([projectLine({ targetHours: 10 })]);

    expect(dto?.payload).toEqual({
      description: 'Website',
      name: 'Website project',
      hourlyRateNet: 100,
      targetHours: 10,
    });
  });

  it('sends pricing model and limit for capped / fixed lines', () => {
    const [dto] = mapOfferFormLinesToDto([projectLine({ pricingModel: 'capped', priceLimitNet: 4800 })]);

    expect(dto?.payload).toEqual(expect.objectContaining({ pricingModel: 'capped', priceLimitNet: 4800 }));
  });

  it('requires a positive limit for capped / fixed lines', () => {
    expect(isOfferFormValid([projectLine({ pricingModel: 'fixed', priceLimitNet: null })])).toBe(false);
    expect(isOfferFormValid([projectLine({ pricingModel: 'fixed', priceLimitNet: 0 })])).toBe(false);
    expect(isOfferFormValid([projectLine({ pricingModel: 'fixed', priceLimitNet: 2500 })])).toBe(true);
    expect(isOfferFormValid([projectLine()])).toBe(true);
  });

  it('computes totals from the limit for capped / fixed lines', () => {
    const rates = { standard: 19, reduced: 7 };

    expect(computeProjectTemplateOfferLineTotals(projectLine({ targetHours: 10 }), rates)?.net).toBe(1000);
    expect(
      computeProjectTemplateOfferLineTotals(
        projectLine({ targetHours: 10, pricingModel: 'capped', priceLimitNet: 800 }),
        rates,
      )?.net,
    ).toBe(800);
    expect(
      computeProjectTemplateOfferLineTotals(projectLine({ pricingModel: 'fixed', priceLimitNet: null }), rates),
    ).toBeNull();
  });

  it('restores pricing from a stored draft line', () => {
    const [form] = mapOfferDetailLinesToForm([
      {
        lineType: 'project_template',
        description: 'Website',
        quantity: 1,
        unitPriceNet: 4800,
        projectTemplatePayload: {
          name: 'Site',
          hourlyRateNet: 100,
          pricingModel: 'capped',
          priceLimitNet: 4800,
          targetHours: null,
        },
      } as unknown as OfferLineResponse,
    ]);

    expect(form).toEqual(
      expect.objectContaining({ pricingModel: 'capped', priceLimitNet: 4800, hourlyRateNet: 100, targetHours: null }),
    );
  });
});

describe('offer article lines', () => {
  const articleLine = (overrides: Partial<ReturnType<typeof createEmptyOfferFormLine>> = {}) => ({
    ...createEmptyOfferFormLine('article'),
    description: 'Router',
    quantity: 2,
    unitPriceNet: 49.9,
    unitLabel: 'pcs',
    taxCategory: 'reduced' as const,
    inventoryArticleId: 'art-1',
    ...overrides,
  });

  it('sends the standard line payload plus the article id', () => {
    const [dto] = mapOfferFormLinesToDto([articleLine()]);

    expect(dto).toEqual({
      lineType: 'article',
      payload: {
        description: 'Router',
        quantity: 2,
        unitPriceNet: 49.9,
        unitLabel: 'pcs',
        taxCategory: 'reduced',
        inventoryArticleId: 'art-1',
      },
    });
  });

  it('requires an article', () => {
    expect(isOfferFormValid([articleLine()])).toBe(true);
    expect(isOfferFormValid([articleLine({ inventoryArticleId: null })])).toBe(false);
  });

  it('restores the article and standard fields when editing a draft', () => {
    const [line] = mapOfferDetailLinesToForm([
      {
        lineType: 'article',
        description: 'Router',
        quantity: 2,
        unitPriceNet: 49.9,
        unitLabel: 'pcs',
        taxCategory: 'reduced',
        inventoryArticleId: 'art-1',
      } as OfferLineResponse,
    ]);

    expect(line).toEqual(
      expect.objectContaining({
        lineType: 'article',
        quantity: 2,
        unitPriceNet: 49.9,
        unitLabel: 'pcs',
        taxCategory: 'reduced',
        inventoryArticleId: 'art-1',
      }),
    );
  });

  it('prices article lines like standard lines', () => {
    expect(computeStandardOfferLineTotals(articleLine(), { standard: 19, reduced: 7 })?.net).toBeCloseTo(99.8);
  });
});
