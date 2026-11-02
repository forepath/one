import { TestBed } from '@angular/core/testing';
import {
  MetersFacade,
  ServiceTypesFacade,
  ServiceTypesService,
  type ServiceTypeResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { ServiceTypesPageComponent } from './service-types-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

const serviceType = (id: string, isActive = true): ServiceTypeResponse =>
  ({
    id,
    key: `st_${id}`,
    name: `Provider ${id}`,
    provider: 'hetzner',
    allowedProviders: ['hetzner'],
    configSchema: {},
    disallowStatutoryWithdrawal: false,
    isActive,
  }) as ServiceTypeResponse;

describe('ServiceTypesPageComponent (data list)', () => {
  let service: { updateServiceType: jest.Mock; deleteServiceType: jest.Mock };
  let facade: Record<string, jest.Mock>;
  let component: ServiceTypesPageComponent;

  beforeEach(() => {
    service = { updateServiceType: jest.fn(), deleteServiceType: jest.fn() };
    facade = {
      getServiceTypes$: jest.fn(() => of([serviceType('s1'), serviceType('s2'), serviceType('s3', false)])),
      getProviderDetails$: jest.fn(() => of([{ id: 'hetzner', displayName: 'Hetzner Cloud' }])),
      getProviderDetailsLoading$: jest.fn(() => of(false)),
      getServiceTypesLoading$: jest.fn(() => of(false)),
      getServiceTypesLoadingAny$: jest.fn(() => of(false)),
      getServiceTypesError$: jest.fn(() => of(null)),
      getServiceTypesCreating$: jest.fn(() => of(false)),
      getServiceTypesUpdating$: jest.fn(() => of(false)),
      getServiceTypesDeleting$: jest.fn(() => of(false)),
      loadServiceTypes: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ServiceTypesFacade, useValue: facade },
        { provide: ServiceTypesService, useValue: service },
        { provide: MetersFacade, useValue: { getMeters$: () => of([]), loadMeters: jest.fn() } },
      ],
    });
    component = TestBed.runInInjectionContext(() => new ServiceTypesPageComponent());
  });

  it('shows State + name + readable providers and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.columns[2].value?.(serviceType('s1'))).toBe('Hetzner Cloud');
  });

  it('builds the provider multi-select options: None first, then providers (DB-08 a)', () => {
    const providers = [
      { id: 'hetzner', displayName: 'Hetzner Cloud' },
      { id: 'digitalocean', displayName: 'DigitalOcean' },
    ] as never;
    const options = component.providerMultiOptions('create', providers);

    expect(options.map((option) => option.value)).toEqual([component.noneProviderValue, 'hetzner', 'digitalocean']);
    expect(options[0].label).toBe('None');
    expect(options[1]).toEqual(expect.objectContaining({ label: 'Hetzner Cloud', disabled: false }));
  });

  it('selecting a provider while None is selected keeps the provider; picking None clears them', () => {
    const providers = [{ id: 'hetzner', displayName: 'Hetzner Cloud' }] as never;

    component.onProvidersSelectionChange('create', [component.noneProviderValue, 'hetzner'], providers);
    expect(component.createSelectedProviders).toEqual(['hetzner']);
    expect(component.createForm.provider).toBe('hetzner');

    component.onProvidersSelectionChange('create', [component.noneProviderValue, 'hetzner'], providers);
    expect(component.createSelectedProviders).toEqual([component.noneProviderValue]);
    expect(component.createForm.allowedProviders).toEqual([]);
  });

  it('bulk Activate / Delete fan out per provider with per-item results (incl. denied)', async () => {
    service.updateServiceType.mockReturnValue(of({}));
    component.selected.set(['s1', 's3']);
    await component.setActiveSelected(true);
    expect(service.updateServiceType).toHaveBeenCalledTimes(1);
    expect(service.updateServiceType).toHaveBeenCalledWith('s3', { isActive: true });

    service.deleteServiceType.mockImplementation((id: string) =>
      id === 's2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selected.set(['s1', 's2']);
    await component.deleteSelected();
    expect(service.deleteServiceType).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(facade['loadServiceTypes']).toHaveBeenCalled();
  });
});
