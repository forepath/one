import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import type { CreateMeterDto, ListParams, MeterResponse, UpdateMeterDto } from '../../types/billing.types';

import { clearSelectedMeter, createMeter, deleteMeter, loadMeter, loadMeters, updateMeter } from './meters.actions';
import { MetersFacade } from './meters.facade';

describe('MetersFacade', () => {
  let facade: MetersFacade;
  let store: jest.Mocked<Store>;
  const mockMeter: MeterResponse = {
    id: 'meter-1',
    key: 'api_calls',
    name: 'API Calls',
    aggregator: 'max',
    defaultUnitPriceNet: 0.01,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    store = { select: jest.fn(), dispatch: jest.fn() } as never;

    TestBed.configureTestingModule({
      providers: [MetersFacade, { provide: Store, useValue: store }],
    });

    facade = TestBed.inject(MetersFacade);
  });

  describe('State Observables', () => {
    it('returns meters observable', (done) => {
      store.select.mockReturnValue(of([mockMeter]));
      facade.getMeters$().subscribe((result) => {
        expect(result).toEqual([mockMeter]);
        done();
      });
    });

    it('returns active meters observable', (done) => {
      store.select.mockReturnValue(of([mockMeter]));
      facade.getActiveMeters$().subscribe((result) => {
        expect(result).toEqual([mockMeter]);
        done();
      });
    });

    it('returns selected meter observable', (done) => {
      store.select.mockReturnValue(of(mockMeter));
      facade.getSelectedMeter$().subscribe((result) => {
        expect(result).toEqual(mockMeter);
        done();
      });
    });

    it('returns loading observables', (done) => {
      store.select.mockReturnValue(of(true));
      facade.getMetersLoading$().subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });
  });

  describe('Actions', () => {
    it('dispatches loadMeters', () => {
      const params: ListParams = { limit: 10 };
      facade.loadMeters(params);
      expect(store.dispatch).toHaveBeenCalledWith(loadMeters({ params }));
    });

    it('dispatches loadMeter', () => {
      facade.loadMeter('meter-1');
      expect(store.dispatch).toHaveBeenCalledWith(loadMeter({ id: 'meter-1' }));
    });

    it('dispatches createMeter', () => {
      const dto: CreateMeterDto = {
        key: 'api_calls',
        name: 'API Calls',
        aggregator: 'max',
        defaultUnitPriceNet: 0.01,
      };
      facade.createMeter(dto);
      expect(store.dispatch).toHaveBeenCalledWith(createMeter({ meter: dto }));
    });

    it('dispatches updateMeter', () => {
      const dto: UpdateMeterDto = { name: 'Updated' };
      facade.updateMeter('meter-1', dto);
      expect(store.dispatch).toHaveBeenCalledWith(updateMeter({ id: 'meter-1', meter: dto }));
    });

    it('dispatches deleteMeter', () => {
      facade.deleteMeter('meter-1');
      expect(store.dispatch).toHaveBeenCalledWith(deleteMeter({ id: 'meter-1' }));
    });

    it('dispatches clearSelectedMeter', () => {
      facade.clearSelectedMeter();
      expect(store.dispatch).toHaveBeenCalledWith(clearSelectedMeter());
    });
  });
});
