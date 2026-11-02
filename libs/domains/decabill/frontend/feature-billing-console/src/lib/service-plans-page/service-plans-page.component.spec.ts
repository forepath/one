import { TestBed } from '@angular/core/testing';
import {
  AddonsFacade,
  AdminBillingService,
  CloudInitConfigsFacade,
  MetersFacade,
  ServicePlansFacade,
  ServicePlansService,
  ServiceTypesFacade,
  ServiceTypesService,
  type ServicePlanResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { ServicePlansPageComponent } from './service-plans-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

/** Facade stub: every `get…$()` streams an empty list, every other method is a spy. */
function facadeStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(overrides, {
    get: (target, key: string) => {
      if (!(key in target)) target[key] = key.endsWith('$') ? jest.fn(() => of([])) : jest.fn(() => of([]));

      return target[key];
    },
  });
}

const plan = (id: string, isActive = true): ServicePlanResponse =>
  ({
    id,
    name: `Plan ${id}`,
    serviceTypeId: 'st1',
    billingIntervalType: 'month',
    billingIntervalValue: 1,
    basePrice: 10,
    isActive,
  }) as unknown as ServicePlanResponse;

describe('ServicePlansPageComponent (data list)', () => {
  let service: { updateServicePlan: jest.Mock; deleteServicePlan: jest.Mock };
  let plansFacade: Record<string, unknown>;
  let component: ServicePlansPageComponent;

  beforeEach(() => {
    service = { updateServicePlan: jest.fn(), deleteServicePlan: jest.fn() };
    plansFacade = facadeStub({
      getServicePlans$: jest.fn(() => of([plan('p1'), plan('p2'), plan('p3', false)])),
      getServicePlansLoading$: jest.fn(() => of(false)),
      getServicePlansError$: jest.fn(() => of(null)),
      loadServicePlans: jest.fn(),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: ServicePlansFacade, useValue: plansFacade },
        {
          provide: ServiceTypesFacade,
          useValue: facadeStub({ getServiceTypes$: jest.fn(() => of([{ id: 'st1', name: 'Docker host' }])) }),
        },
        { provide: CloudInitConfigsFacade, useValue: facadeStub() },
        { provide: AddonsFacade, useValue: facadeStub() },
        { provide: MetersFacade, useValue: facadeStub() },
        { provide: ServicePlansService, useValue: service },
        { provide: ServiceTypesService, useValue: facadeStub() },
        { provide: AdminBillingService, useValue: facadeStub() },
      ],
    });
    component = TestBed.runInInjectionContext(() => new ServicePlansPageComponent());
  });

  it('shows State + plan name + readable service provider and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.columns[2].value?.(plan('p1'))).toBe('Docker host');
  });

  it('builds server-type multi-select options with the provider as hint when several providers apply (DB-08 a)', () => {
    component.currentServerTypes = [{ id: 'cx11' }, { id: 's-1' }] as never;
    component.currentServerTypeGroups = [
      { providerId: 'hetzner', label: 'Hetzner', types: [{ id: 'cx11' }] },
      { providerId: 'do', label: 'DigitalOcean', types: [{ id: 's-1' }] },
    ] as never;

    expect(component.serverTypeMultiOptions().map((option) => [option.value, option.hint])).toEqual([
      ['cx11', 'Hetzner'],
      ['s-1', 'DigitalOcean'],
    ]);

    component.currentServerTypeGroups = [];
    expect(component.serverTypeMultiOptions().map((option) => option.hint)).toEqual([undefined, undefined]);
  });

  it('bulk Deactivate / Delete fan out per plan with per-item results (incl. denied)', async () => {
    service.updateServicePlan.mockReturnValue(of({}));
    component.selected.set(['p1', 'p3']);
    await component.setActiveSelected(false);
    expect(service.updateServicePlan).toHaveBeenCalledTimes(1);
    expect(service.updateServicePlan).toHaveBeenCalledWith('p1', { isActive: false });

    service.deleteServicePlan.mockImplementation((id: string) =>
      id === 'p2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selected.set(['p1', 'p2']);
    await component.deleteSelected();
    expect(service.deleteServicePlan).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(plansFacade['loadServicePlans']).toHaveBeenCalled();
  });
});
