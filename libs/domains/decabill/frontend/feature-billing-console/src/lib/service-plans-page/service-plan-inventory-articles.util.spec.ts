import {
  areServicePlanInventoryArticleRowsValid,
  isDuplicateServicePlanInventoryArticle,
  isValidServicePlanInventoryQuantity,
  servicePlanInventoryArticleRowsFromPlan,
  servicePlanInventoryArticlesForSubmit,
} from './service-plan-inventory-articles.util';

describe('service plan inventory articles', () => {
  it('accepts positive quantities with up to three decimals', () => {
    expect(isValidServicePlanInventoryQuantity(1)).toBe(true);
    expect(isValidServicePlanInventoryQuantity(0.125)).toBe(true);
    expect(isValidServicePlanInventoryQuantity(0.1 + 0.2)).toBe(false);
    expect(isValidServicePlanInventoryQuantity(1.2345)).toBe(false);
    expect(isValidServicePlanInventoryQuantity(0)).toBe(false);
    expect(isValidServicePlanInventoryQuantity(-1)).toBe(false);
    expect(isValidServicePlanInventoryQuantity(null)).toBe(false);
  });

  it('requires complete rows with unique articles (max 50)', () => {
    expect(areServicePlanInventoryArticleRowsValid([])).toBe(true);
    expect(
      areServicePlanInventoryArticleRowsValid([
        { articleId: 'a', quantity: 1 },
        { articleId: 'b', quantity: 2.5 },
      ]),
    ).toBe(true);
    expect(areServicePlanInventoryArticleRowsValid([{ articleId: null, quantity: 1 }])).toBe(false);
    expect(areServicePlanInventoryArticleRowsValid([{ articleId: 'a', quantity: null }])).toBe(false);
    expect(
      areServicePlanInventoryArticleRowsValid([
        { articleId: 'a', quantity: 1 },
        { articleId: 'a', quantity: 2 },
      ]),
    ).toBe(false);
    expect(
      areServicePlanInventoryArticleRowsValid(
        Array.from({ length: 51 }, (_, index) => ({ articleId: `a${index}`, quantity: 1 })),
      ),
    ).toBe(false);
  });

  it('flags repeated articles from the second occurrence on', () => {
    const rows = [
      { articleId: 'a', quantity: 1 },
      { articleId: 'a', quantity: 2 },
    ];

    expect(isDuplicateServicePlanInventoryArticle(rows, 0)).toBe(false);
    expect(isDuplicateServicePlanInventoryArticle(rows, 1)).toBe(true);
  });

  it('maps plan responses to rows and rows back to the payload', () => {
    const rows = servicePlanInventoryArticleRowsFromPlan([{ articleId: 'a', quantity: 2 }]);

    expect(rows).toEqual([{ articleId: 'a', quantity: 2 }]);
    expect(servicePlanInventoryArticleRowsFromPlan(undefined)).toEqual([]);
    expect(servicePlanInventoryArticlesForSubmit([...rows, { articleId: 'b', quantity: 0.5 }])).toEqual([
      { articleId: 'a', quantity: 2 },
      { articleId: 'b', quantity: 0.5 },
    ]);
  });
});
