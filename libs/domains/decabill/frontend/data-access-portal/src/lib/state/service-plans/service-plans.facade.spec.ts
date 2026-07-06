import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { firstValueFrom, of } from 'rxjs';

import type { PublicServicePlanOffering } from '../../types/portal-service-plans.types';

import { loadCheapestServicePlanOffering, loadServicePlans } from './service-plans.actions';
import { ServicePlansFacade } from './service-plans.facade';

describe('ServicePlansFacade', () => {
  let facade: ServicePlansFacade;
  let store: jest.Mocked<Store>;
  const mockOffering: PublicServicePlanOffering = {
    id: 'sp-1',
    name: 'Basic',
    description: null,
    serviceTypeId: 'st-1',
    serviceTypeName: 'Cloud',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    totalPrice: 99,
    orderingHighlights: [],
    withdrawalPolicy: {
      periodDays: 14,
      allowedAfterProvisioning: true,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    },
  };

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [ServicePlansFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(ServicePlansFacade);
  });

  it.each([
    ['getServicePlans$', () => facade.getServicePlans$(), [mockOffering]],
    ['getCheapestServicePlanOffering$', () => facade.getCheapestServicePlanOffering$(), mockOffering],
    ['getServicePlansLoading$', () => facade.getServicePlansLoading$(), true],
    ['getCheapestServicePlanOfferingLoading$', () => facade.getCheapestServicePlanOfferingLoading$(), true],
    ['getServicePlansLoaded$', () => facade.getServicePlansLoaded$(), true],
    ['getCheapestServicePlanOfferingLoaded$', () => facade.getCheapestServicePlanOfferingLoaded$(), true],
    ['getServicePlansError$', () => facade.getServicePlansError$(), 'load failed'],
    ['getCheapestServicePlanOfferingError$', () => facade.getCheapestServicePlanOfferingError$(), 'not found'],
    ['getServicePlansCount$', () => facade.getServicePlansCount$(), 2],
    ['hasServicePlans$', () => facade.hasServicePlans$(), true],
    ['getServicePlanById$', () => facade.getServicePlanById$('sp-1'), mockOffering],
    ['getServicePlansByServiceTypeId$', () => facade.getServicePlansByServiceTypeId$('st-1'), [mockOffering]],
  ])('%s should select from store', async (_label, observableFactory, expected) => {
    store.select.mockReturnValue(of(expected));
    await expect(firstValueFrom(observableFactory())).resolves.toEqual(expected);
  });

  it('loadCheapestServicePlanOffering should dispatch with service type', () => {
    facade.loadCheapestServicePlanOffering('st-x');
    expect(store.dispatch).toHaveBeenCalledWith(loadCheapestServicePlanOffering({ serviceTypeId: 'st-x' }));
  });

  it('loadCheapestServicePlanOffering should dispatch without service type', () => {
    facade.loadCheapestServicePlanOffering();
    expect(store.dispatch).toHaveBeenCalledWith(loadCheapestServicePlanOffering({ serviceTypeId: undefined }));
  });

  it('loadServicePlans should dispatch with params', () => {
    facade.loadServicePlans({ limit: 5 });
    expect(store.dispatch).toHaveBeenCalledWith(loadServicePlans({ params: { limit: 5 } }));
  });

  it('loadServicePlans should dispatch without params', () => {
    facade.loadServicePlans();
    expect(store.dispatch).toHaveBeenCalledWith(loadServicePlans({ params: undefined }));
  });
});
