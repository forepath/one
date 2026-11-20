import type { ServerType, ServicePlanResponse } from '@forepath/decabill/frontend/data-access-billing-console';

import { resolvePlanCustomerPrice } from './plan-customer-price.util';

const plan = (overrides: Partial<ServicePlanResponse>): ServicePlanResponse => overrides as ServicePlanResponse;
const type = (overrides: Partial<ServerType>): ServerType => ({
  id: 'cx',
  name: 'CX',
  cores: 1,
  memory: 1,
  disk: 1,
  ...overrides,
});

describe('resolvePlanCustomerPrice', () => {
  it('uses the server price of a customer response (no base price or margins)', () => {
    expect(resolvePlanCustomerPrice(plan({ customerPrice: 13 }))).toBe(13);
  });

  it('uses the server price of the chosen server type', () => {
    expect(resolvePlanCustomerPrice(plan({ customerPrice: 13 }), type({ customerPrice: 25.5 }))).toBe(25.5);
  });

  it('shows no price for free / unpriced plans', () => {
    expect(resolvePlanCustomerPrice(plan({ customerPrice: 0 }))).toBeNull();
    expect(resolvePlanCustomerPrice(plan({}))).toBeNull();
  });

  it('falls back to base price plus margins for admin-shaped responses', () => {
    expect(resolvePlanCustomerPrice(plan({ basePrice: '10', marginPercent: '20', marginFixed: '1' }))).toBe(13);
    expect(resolvePlanCustomerPrice(plan({ marginPercent: '20', marginFixed: '1' }), type({ priceMonthly: 20 }))).toBe(
      25,
    );
  });
});
