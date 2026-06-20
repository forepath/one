import { PricingService } from './pricing.service';

describe('PricingService', () => {
  const service = new PricingService();

  it('applies percent and fixed margin', () => {
    const plan = {
      basePrice: '10',
      marginPercent: '10',
      marginFixed: '2',
    } as any;
    const result = service.calculate(plan);

    expect(result.totalPrice).toBe(10 + 1 + 2);
  });
});
