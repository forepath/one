import { normalizeProjectBreakdown } from './forepath-breakdown-normalizer.utils';

describe('normalizeProjectBreakdown', () => {
  it('should round billing units to whole hours and sort line items by service', () => {
    const normalized = normalizeProjectBreakdown({
      summary: '  Portal build  ',
      lineItems: [
        {
          serviceId: 'travel-km',
          description: 'On-site travel',
          quantity: 12.6,
        },
        {
          serviceId: 'software-development',
          description: 'Backend API',
          billingUnits: 513,
        },
        {
          serviceId: 'consulting',
          description: 'Discovery workshop',
          billingUnits: 7,
        },
      ],
      assumptions: [' Remote-first delivery '],
      confidence: 'medium',
    });

    expect(normalized.summary).toBe('Portal build');
    expect(normalized.lineItems.map((item) => item.serviceId)).toEqual([
      'consulting',
      'software-development',
      'travel-km',
    ]);
    expect(normalized.lineItems[0]?.billingUnits).toBe(8);
    expect(normalized.lineItems[1]?.billingUnits).toBe(512);
    expect(normalized.lineItems[2]?.quantity).toBe(13);
  });
});
