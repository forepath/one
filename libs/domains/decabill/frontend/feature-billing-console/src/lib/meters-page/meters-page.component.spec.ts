import { TestBed } from '@angular/core/testing';
import {
  MetersFacade,
  MetersService,
  type MeterResponse,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { MetersPageComponent } from './meters-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));

const meter = (id: string, isActive = true): MeterResponse =>
  ({
    id,
    key: `key_${id}`,
    name: `Meter ${id}`,
    aggregator: 'max',
    defaultUnitPriceNet: 0.5,
    defaultIncludedUsage: 0,
    isActive,
  }) as MeterResponse;

describe('MetersPageComponent (data list)', () => {
  let service: { updateMeter: jest.Mock; deleteMeter: jest.Mock };
  let facade: Record<string, jest.Mock>;
  let component: MetersPageComponent;

  beforeEach(() => {
    service = { updateMeter: jest.fn(), deleteMeter: jest.fn() };
    facade = {
      getMeters$: jest.fn(() => of([meter('m1'), meter('m2'), meter('m3', false)])),
      getMetersLoading$: jest.fn(() => of(false)),
      getMetersLoadingAny$: jest.fn(() => of(false)),
      getMetersCreating$: jest.fn(() => of(false)),
      getMetersUpdating$: jest.fn(() => of(false)),
      getMetersDeleting$: jest.fn(() => of(false)),
      getMetersError$: jest.fn(() => of(null)),
      loadMeters: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: MetersFacade, useValue: facade },
        { provide: MetersService, useValue: service },
      ],
    });
    component = TestBed.runInInjectionContext(() => new MetersPageComponent());
  });

  it('has a State column first, the meter name as required name column, and no raw id column', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1]).toEqual(expect.objectContaining({ id: 'name', required: true, priority: 1 }));
    expect(component.columns.map((c) => c.id)).not.toContain('id');
    expect(component.rowMenu().map((item) => item.id)).toEqual(['edit', 'delete', 'copy-id']);
  });

  it('bulk Deactivate updates each active meter and reports per-item results (incl. denied)', async () => {
    service.updateMeter.mockImplementation((id: string) =>
      id === 'm2' ? throwError(() => ({ status: 403 })) : of(meter(id, false)),
    );
    component.selected.set(['m1', 'm2', 'm3']);

    await component.setActiveSelected(false);

    expect(service.updateMeter).toHaveBeenCalledTimes(2);
    expect(service.updateMeter).toHaveBeenCalledWith('m1', { isActive: false });
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selected()).toEqual([]);
    expect(facade['loadMeters']).toHaveBeenCalled();
  });

  it('bulk Delete calls deleteMeter per meter', async () => {
    service.deleteMeter.mockImplementation((id: string) =>
      id === 'm3' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selected.set(['m1', 'm3']);

    await component.deleteSelected();

    expect(service.deleteMeter).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()).toEqual(expect.objectContaining({ tone: 'warning' }));
  });
});
