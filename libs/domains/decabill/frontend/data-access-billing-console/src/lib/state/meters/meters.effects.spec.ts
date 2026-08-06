import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { MetersService } from '../../services/meters.service';
import type { MeterResponse } from '../../types/billing.types';

import {
  createMeter,
  createMeterFailure,
  createMeterSuccess,
  deleteMeter,
  deleteMeterFailure,
  deleteMeterSuccess,
  loadMeter,
  loadMeterFailure,
  loadMeters,
  loadMetersBatch,
  loadMetersFailure,
  loadMetersSuccess,
  loadMeterSuccess,
  updateMeter,
  updateMeterFailure,
  updateMeterSuccess,
} from './meters.actions';
import { createMeter$, deleteMeter$, loadMeter$, loadMeters$, loadMetersBatch$, updateMeter$ } from './meters.effects';

describe('metersEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<MetersService>;
  const meter: MeterResponse = {
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
    service = {
      listMeters: jest.fn(),
      getMeter: jest.fn(),
      createMeter: jest.fn(),
      updateMeter: jest.fn(),
      deleteMeter: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: MetersService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loads meters', (done) => {
    actions$ = of(loadMeters({}));
    service.listMeters.mockReturnValue(of([meter]));

    loadMeters$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadMetersSuccess({ meters: [meter] }));
      done();
    });
  });

  it('starts a batch when the first page is full', (done) => {
    const page = Array.from({ length: 10 }, (_, index) => ({ ...meter, id: `meter-${index}` }));
    actions$ = of(loadMeters({}));
    service.listMeters.mockReturnValue(of(page));

    loadMeters$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadMetersBatch({ offset: 10, accumulatedMeters: page }));
      done();
    });
  });

  it('continues batching until the last page', (done) => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ({ ...meter, id: `meter-${index}` }));
    const lastPage = [{ ...meter, id: 'meter-10' }];
    actions$ = of(loadMetersBatch({ offset: 10, accumulatedMeters: firstPage }));
    service.listMeters.mockReturnValue(of(lastPage));

    loadMetersBatch$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadMetersSuccess({ meters: [...firstPage, ...lastPage] }));
      done();
    });
  });

  it('maps load errors', (done) => {
    actions$ = of(loadMeters({}));
    service.listMeters.mockReturnValue(throwError(() => new Error('Load failed')));

    loadMeters$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadMetersFailure({ error: 'Load failed' }));
      done();
    });
  });

  it('loads a single meter', (done) => {
    actions$ = of(loadMeter({ id: meter.id }));
    service.getMeter.mockReturnValue(of(meter));

    loadMeter$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadMeterSuccess({ meter }));
      done();
    });
  });

  it('maps single meter load errors', (done) => {
    actions$ = of(loadMeter({ id: meter.id }));
    service.getMeter.mockReturnValue(throwError(() => 'not found'));

    loadMeter$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadMeterFailure({ error: 'not found' }));
      done();
    });
  });

  it('creates a meter', (done) => {
    actions$ = of(createMeter({ meter: {} as never }));
    service.createMeter.mockReturnValue(of(meter));

    createMeter$(actions$, service).subscribe((result) => {
      expect(result).toEqual(createMeterSuccess({ meter }));
      done();
    });
  });

  it('updates a meter', (done) => {
    actions$ = of(updateMeter({ id: meter.id, meter: { name: 'Updated' } }));
    service.updateMeter.mockReturnValue(of({ ...meter, name: 'Updated' }));

    updateMeter$(actions$, service).subscribe((result) => {
      expect(result).toEqual(updateMeterSuccess({ meter: { ...meter, name: 'Updated' } }));
      done();
    });
  });

  it('deletes a meter', (done) => {
    actions$ = of(deleteMeter({ id: meter.id }));
    service.deleteMeter.mockReturnValue(of(undefined));

    deleteMeter$(actions$, service).subscribe((result) => {
      expect(result).toEqual(deleteMeterSuccess({ id: meter.id }));
      done();
    });
  });

  it('maps delete errors', (done) => {
    actions$ = of(deleteMeter({ id: meter.id }));
    service.deleteMeter.mockReturnValue(throwError(() => ({ code: 500 })));

    deleteMeter$(actions$, service).subscribe((result) => {
      expect(result).toEqual(deleteMeterFailure({ error: 'An unexpected error occurred' }));
      done();
    });
  });
});
