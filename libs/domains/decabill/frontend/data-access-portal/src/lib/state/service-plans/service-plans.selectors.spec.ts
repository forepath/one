import type { PublicServicePlanOffering } from '../../types/portal-service-plans.types';

import { initialServicePlansState, type ServicePlansState } from './service-plans.reducer';
import {
  selectCheapestServicePlanOffering,
  selectCheapestServicePlanOfferingError,
  selectCheapestServicePlanOfferingLoaded,
  selectCheapestServicePlanOfferingLoading,
  selectHasServicePlans,
  selectServicePlanById,
  selectServicePlansByServiceTypeId,
  selectServicePlansCount,
  selectServicePlansEntities,
  selectServicePlansError,
  selectServicePlansLoaded,
  selectServicePlansLoading,
  selectServicePlansState,
} from './service-plans.selectors';

describe('Portal Service Plans Selectors', () => {
  const mockOffering: PublicServicePlanOffering = {
    id: 'sp-1',
    name: 'Basic',
    description: null,
    serviceTypeId: 'st-1',
    serviceTypeName: 'Cloud',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    billInAdvance: false,
    totalPrice: 99,
    totalGross: 117.81,
    taxRate: 19,
    orderingHighlights: [],
    allowCustomerServerTypeSelection: false,
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
  };
  const mockOffering2: PublicServicePlanOffering = {
    id: 'sp-2',
    name: 'Pro',
    description: null,
    serviceTypeId: 'st-2',
    serviceTypeName: 'Other',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    billInAdvance: false,
    totalPrice: 199,
    totalGross: 236.81,
    taxRate: 19,
    orderingHighlights: [],
    allowCustomerServerTypeSelection: false,
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
  };
  const createState = (overrides?: Partial<ServicePlansState>): ServicePlansState => ({
    ...initialServicePlansState,
    ...overrides,
  });

  it('selectServicePlansState should select feature state', () => {
    const state = createState();

    expect(selectServicePlansState({ servicePlans: state } as never)).toEqual(state);
  });

  it('selectServicePlansEntities should select entities', () => {
    const state = createState({ entities: [mockOffering, mockOffering2] });

    expect(selectServicePlansEntities({ servicePlans: state } as never)).toEqual([mockOffering, mockOffering2]);
  });

  it('selectCheapestServicePlanOffering should select cheapest', () => {
    const state = createState({ cheapestOffering: mockOffering });

    expect(selectCheapestServicePlanOffering({ servicePlans: state } as never)).toEqual(mockOffering);
  });

  it('selectServicePlansLoading should select loading', () => {
    const state = createState({ loading: true });

    expect(selectServicePlansLoading({ servicePlans: state } as never)).toBe(true);
  });

  it('selectCheapestServicePlanOfferingLoading should select loadingCheapest', () => {
    const state = createState({ loadingCheapest: true });

    expect(selectCheapestServicePlanOfferingLoading({ servicePlans: state } as never)).toBe(true);
  });

  it('selectServicePlansLoaded should select plansLoaded', () => {
    const state = createState({ plansLoaded: true });

    expect(selectServicePlansLoaded({ servicePlans: state } as never)).toBe(true);
  });

  it('selectCheapestServicePlanOfferingLoaded should select cheapestLoaded', () => {
    const state = createState({ cheapestLoaded: true });

    expect(selectCheapestServicePlanOfferingLoaded({ servicePlans: state } as never)).toBe(true);
  });

  it('selectServicePlansError should select plansError', () => {
    const state = createState({ plansError: 'e' });

    expect(selectServicePlansError({ servicePlans: state } as never)).toBe('e');
  });

  it('selectCheapestServicePlanOfferingError should select cheapestError', () => {
    const state = createState({ cheapestError: 'cheapest failed' });

    expect(selectCheapestServicePlanOfferingError({ servicePlans: state } as never)).toBe('cheapest failed');
  });

  it('selectServicePlansCount should count entities', () => {
    const state = createState({ entities: [mockOffering] });

    expect(selectServicePlansCount({ servicePlans: state } as never)).toBe(1);
  });

  it('selectHasServicePlans should be true when entities exist', () => {
    const state = createState({ entities: [mockOffering] });

    expect(selectHasServicePlans({ servicePlans: state } as never)).toBe(true);
  });

  it('selectServicePlanById should find by id', () => {
    const state = createState({ entities: [mockOffering, mockOffering2] });

    expect(selectServicePlanById('sp-2')({ servicePlans: state } as never)).toEqual(mockOffering2);
  });

  it('selectServicePlansByServiceTypeId should filter', () => {
    const state = createState({ entities: [mockOffering, mockOffering2] });

    expect(selectServicePlansByServiceTypeId('st-1')({ servicePlans: state } as never)).toEqual([mockOffering]);
  });
});
