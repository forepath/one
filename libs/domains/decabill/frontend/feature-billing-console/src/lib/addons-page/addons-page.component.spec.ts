import { TestBed } from '@angular/core/testing';
import {
  AddonsFacade,
  AddonsService,
  MetersFacade,
  ServiceTypesFacade,
  type AddonResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AddonsPageComponent } from './addons-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

jest.mock('../monaco-editor-wrapper/monaco-editor-wrapper.component', () => {
  const { Component } = jest.requireActual('@angular/core');

  @Component({ selector: 'framework-monaco-editor-wrapper', standalone: true, template: '' })
  class MonacoEditorWrapperComponent {}

  return { MonacoEditorWrapperComponent };
});

const addon = (id: string, isActive = true): AddonResponse =>
  ({
    id,
    key: `addon_${id}`,
    name: `Addon ${id}`,
    implementationType: 'module',
    basePrice: 5,
    priceIntervalType: 'month',
    priceIntervalValue: 1,
    compatibleProviders: ['hetzner'],
    isActive,
  }) as unknown as AddonResponse;

describe('AddonsPageComponent (data list)', () => {
  let service: { updateAddon: jest.Mock; deleteAddon: jest.Mock };
  let facade: Record<string, jest.Mock>;
  let component: AddonsPageComponent;

  beforeEach(() => {
    service = { updateAddon: jest.fn(), deleteAddon: jest.fn() };
    facade = {
      getAddons$: jest.fn(() => of([addon('a1'), addon('a2'), addon('a3', false)])),
      getAddonsLoading$: jest.fn(() => of(false)),
      getAddonsLoadingAny$: jest.fn(() => of(false)),
      getAddonsCreating$: jest.fn(() => of(false)),
      getAddonsUpdating$: jest.fn(() => of(false)),
      getAddonsDeleting$: jest.fn(() => of(false)),
      getAddonsError$: jest.fn(() => of(null)),
      loadAddons: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AddonsFacade, useValue: facade },
        { provide: AddonsService, useValue: service },
        { provide: MetersFacade, useValue: { getActiveMeters$: () => of([]), loadMeters: jest.fn() } },
        {
          provide: ServiceTypesFacade,
          useValue: {
            getProviderDetails$: () => of([{ id: 'hetzner', displayName: 'Hetzner Cloud', supportsAddons: true }]),
            loadProviderDetails: jest.fn(),
          },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AddonsPageComponent());
  });

  it('shows State + name columns, readable price / providers and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.formatPrice(addon('a1'))).toBe('€5.00 / Monthly');
    expect(component.compatibleProvidersLabel(addon('a1'))).toBe('Hetzner Cloud');
  });

  it('maps providers to multi-select options and keeps the selection payload (DB-08 a)', () => {
    const options = component.addonProviderOptions([{ id: 'hetzner', displayName: 'Hetzner Cloud' }] as never);

    expect(options).toEqual([
      {
        value: 'hetzner',
        label: component.providerOptionLabel({ id: 'hetzner', displayName: 'Hetzner Cloud' } as never),
      },
    ]);
  });

  it('bulk Activate updates only inactive addons; bulk Delete reports per-item results (incl. denied)', async () => {
    service.updateAddon.mockReturnValue(of({}));
    component.selected.set(['a1', 'a3']);
    await component.setActiveSelected(true);
    expect(service.updateAddon).toHaveBeenCalledTimes(1);
    expect(service.updateAddon).toHaveBeenCalledWith('a3', { isActive: true });

    service.deleteAddon.mockImplementation((id: string) =>
      id === 'a2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selected.set(['a1', 'a2']);
    await component.deleteSelected();
    expect(service.deleteAddon).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(facade['loadAddons']).toHaveBeenCalled();
  });
});
