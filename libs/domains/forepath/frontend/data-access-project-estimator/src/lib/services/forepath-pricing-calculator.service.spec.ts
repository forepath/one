import { ForepathPricingCalculatorService } from './forepath-pricing-calculator.service';

describe('ForepathPricingCalculatorService', () => {
  const service = new ForepathPricingCalculatorService();

  it('should calculate software development totals', () => {
    const estimate = service.calculateEstimate({
      summary: 'App build',
      lineItems: [
        {
          serviceId: 'software-development',
          description: 'Implementation',
          billingUnits: 4,
        },
      ],
      assumptions: [],
      confidence: 'high',
    });

    expect(estimate.lineItems[0]?.serviceName).toBe('Software Development');
    expect(estimate.lineItems[0]?.lineTotal).toBe(135.04);
    expect(estimate.subtotalNet).toBe(135.04);
  });

  it('should calculate IT emergency tiers and travel items', () => {
    const estimate = service.calculateEstimate({
      summary: 'On-site support',
      lineItems: [
        {
          serviceId: 'it-systems',
          description: 'Emergency support',
          billingUnits: 2,
          rateTier: 'emergency-week',
        },
        {
          serviceId: 'travel-km',
          description: 'Travel distance',
          quantity: 20,
        },
        {
          serviceId: 'travel-short',
          description: 'Local travel flat rate',
        },
      ],
      assumptions: ['Includes travel'],
      confidence: 'medium',
    });

    expect(estimate.lineItems[0]?.lineTotal).toBe(91.62);
    expect(estimate.lineItems[1]?.lineTotal).toBe(15);
    expect(estimate.lineItems[2]?.lineTotal).toBe(48.23);
    expect(estimate.subtotalNet).toBe(154.85);
  });

  it('should include catalog context for prompts', () => {
    const catalog = service.buildCatalogPromptContext();

    expect(catalog).toContain('software-development');
    expect(catalog).toContain('33.76');
  });
});
