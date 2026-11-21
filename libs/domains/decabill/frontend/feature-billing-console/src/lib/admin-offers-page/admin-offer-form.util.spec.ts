import { createEmptyOfferFormLine, mapOfferFormLinesToDto, type OfferFormLineItem } from './admin-offer-form.util';

/** `fpc-form-control` number inputs report strings; the form model holds what the user typed. */
const typed = <T>(value: string): T => value as unknown as T;

describe('mapOfferFormLinesToDto', () => {
  it('sends standard / article positions with numeric quantity and price', () => {
    const standard: OfferFormLineItem = {
      ...createEmptyOfferFormLine('standard'),
      description: ' Setup ',
      quantity: typed('2'),
      unitPriceNet: typed('149.5'),
    };
    const article: OfferFormLineItem = {
      ...createEmptyOfferFormLine('article'),
      description: 'Switch',
      quantity: typed('3'),
      unitPriceNet: typed('20'),
      inventoryArticleId: 'art-1',
    };
    const [first, second] = mapOfferFormLinesToDto([standard, article]);

    expect(first?.payload).toEqual(expect.objectContaining({ description: 'Setup', quantity: 2, unitPriceNet: 149.5 }));
    expect(second?.payload).toEqual(
      expect.objectContaining({ quantity: 3, unitPriceNet: 20, inventoryArticleId: 'art-1' }),
    );
  });

  it('sends project template rates, target hours and price limits as numbers', () => {
    const line: OfferFormLineItem = {
      ...createEmptyOfferFormLine('project_template'),
      description: 'Build',
      name: 'Website',
      hourlyRateNet: typed('95'),
      targetHours: typed('40'),
      pricingModel: 'capped',
      priceLimitNet: typed('3800'),
    };

    expect(mapOfferFormLinesToDto([line])[0]?.payload).toEqual(
      expect.objectContaining({ hourlyRateNet: 95, targetHours: 40, priceLimitNet: 3800, pricingModel: 'capped' }),
    );
  });

  it('omits empty target hours instead of sending a string', () => {
    const line: OfferFormLineItem = {
      ...createEmptyOfferFormLine('project_template'),
      description: 'Build',
      name: 'Website',
      hourlyRateNet: typed('95'),
      targetHours: typed(''),
    };

    expect(mapOfferFormLinesToDto([line])[0]?.payload).not.toHaveProperty('targetHours');
  });
});
