import type { PublicServicePlanOffering } from '../types/portal-service-plans.types';

import { formatPublicOfferingPrice } from './public-offering-price.utils';

describe('formatPublicOfferingPrice', () => {
  const baseOffering: PublicServicePlanOffering = {
    id: 'plan-1',
    name: 'Pro',
    description: null,
    serviceTypeId: 'st-1',
    serviceTypeName: 'Hosting',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    billInAdvance: false,
    totalPrice: 10,
    totalGross: 11.9,
    taxRate: 19,
    orderingHighlights: [],
    allowCustomerLocationSelection: false,
    allowCustomerServerTypeSelection: false,
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
  };

  it('returns totalGross without prefix for fixed-price plans', () => {
    expect(formatPublicOfferingPrice(baseOffering)).toEqual({ prefix: '', amount: 11.9 });
  });

  it('returns from prefix when selectable plan has lower totalGrossFrom', () => {
    const offering: PublicServicePlanOffering = {
      ...baseOffering,
      allowCustomerServerTypeSelection: true,
      totalGrossFrom: 4.94,
    };

    expect(formatPublicOfferingPrice(offering)).toEqual({ prefix: 'from ', amount: 4.94 });
  });

  it('returns totalGross when totalGrossFrom is not lower', () => {
    const offering: PublicServicePlanOffering = {
      ...baseOffering,
      allowCustomerServerTypeSelection: true,
      totalGrossFrom: 12,
    };

    expect(formatPublicOfferingPrice(offering)).toEqual({ prefix: '', amount: 11.9 });
  });
});
