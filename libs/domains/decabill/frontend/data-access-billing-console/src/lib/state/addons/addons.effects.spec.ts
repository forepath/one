import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AddonsService } from '../../services/addons.service';
import type { AddonResponse } from '../../types/billing.types';

import {
  createAddon,
  createAddonFailure,
  createAddonSuccess,
  deleteAddon,
  deleteAddonFailure,
  deleteAddonSuccess,
  loadAddon,
  loadAddonFailure,
  loadAddons,
  loadAddonsBatch,
  loadAddonsFailure,
  loadAddonsSuccess,
  loadAddonSuccess,
  updateAddon,
  updateAddonFailure,
  updateAddonSuccess,
} from './addons.actions';
import { createAddon$, deleteAddon$, loadAddon$, loadAddons$, loadAddonsBatch$, updateAddon$ } from './addons.effects';

describe('addonsEffects', () => {
  let actions$: Actions;
  let service: jest.Mocked<AddonsService>;
  const addon: AddonResponse = {
    id: 'addon-1',
    key: 'backup',
    name: 'Backup',
    implementationType: 'module',
    moduleKey: 'backup',
    configSchema: {},
    compatibleProviders: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    service = {
      listAddons: jest.fn(),
      getAddon: jest.fn(),
      createAddon: jest.fn(),
      updateAddon: jest.fn(),
      deleteAddon: jest.fn(),
    } as never;

    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AddonsService, useValue: service }],
    });
    actions$ = TestBed.inject(Actions);
  });

  it('loads addons', (done) => {
    actions$ = of(loadAddons({}));
    service.listAddons.mockReturnValue(of([addon]));

    loadAddons$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonsSuccess({ addons: [addon] }));
      done();
    });
  });

  it('starts a batch when the first page is full', (done) => {
    const page = Array.from({ length: 10 }, (_, index) => ({ ...addon, id: `addon-${index}` }));

    actions$ = of(loadAddons({}));
    service.listAddons.mockReturnValue(of(page));

    loadAddons$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonsBatch({ offset: 10, accumulatedAddons: page }));
      done();
    });
  });

  it('continues batching until the last page', (done) => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ({ ...addon, id: `addon-${index}` }));
    const lastPage = [{ ...addon, id: 'addon-10' }];

    actions$ = of(loadAddonsBatch({ offset: 10, accumulatedAddons: firstPage }));
    service.listAddons.mockReturnValue(of(lastPage));

    loadAddonsBatch$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonsSuccess({ addons: [...firstPage, ...lastPage] }));
      done();
    });
  });

  it('maps load errors', (done) => {
    actions$ = of(loadAddons({}));
    service.listAddons.mockReturnValue(throwError(() => new Error('Load failed')));

    loadAddons$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonsFailure({ error: 'Load failed' }));
      done();
    });
  });

  it('maps batch load errors', (done) => {
    actions$ = of(loadAddonsBatch({ offset: 10, accumulatedAddons: [addon] }));
    service.listAddons.mockReturnValue(throwError(() => ({ message: 'Batch failed' })));

    loadAddonsBatch$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonsFailure({ error: 'Batch failed' }));
      done();
    });
  });

  it('loads a single addon', (done) => {
    actions$ = of(loadAddon({ id: addon.id }));
    service.getAddon.mockReturnValue(of(addon));

    loadAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonSuccess({ addon }));
      done();
    });
  });

  it('maps single addon load errors', (done) => {
    actions$ = of(loadAddon({ id: addon.id }));
    service.getAddon.mockReturnValue(throwError(() => 'not found'));

    loadAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(loadAddonFailure({ error: 'not found' }));
      done();
    });
  });

  it('creates an addon', (done) => {
    actions$ = of(createAddon({ addon: {} as never }));
    service.createAddon.mockReturnValue(of(addon));

    createAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(createAddonSuccess({ addon }));
      done();
    });
  });

  it('maps create errors', (done) => {
    actions$ = of(createAddon({ addon: {} as never }));
    service.createAddon.mockReturnValue(throwError(() => new Error('Create failed')));

    createAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(createAddonFailure({ error: 'Create failed' }));
      done();
    });
  });

  it('updates an addon', (done) => {
    actions$ = of(updateAddon({ id: addon.id, addon: { name: 'Updated' } }));
    service.updateAddon.mockReturnValue(of({ ...addon, name: 'Updated' }));

    updateAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(updateAddonSuccess({ addon: { ...addon, name: 'Updated' } }));
      done();
    });
  });

  it('maps update errors', (done) => {
    actions$ = of(updateAddon({ id: addon.id, addon: { name: 'Updated' } }));
    service.updateAddon.mockReturnValue(throwError(() => new Error('Update failed')));

    updateAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(updateAddonFailure({ error: 'Update failed' }));
      done();
    });
  });

  it('deletes an addon', (done) => {
    actions$ = of(deleteAddon({ id: addon.id }));
    service.deleteAddon.mockReturnValue(of(undefined));

    deleteAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(deleteAddonSuccess({ id: addon.id }));
      done();
    });
  });

  it('maps delete errors', (done) => {
    actions$ = of(deleteAddon({ id: addon.id }));
    service.deleteAddon.mockReturnValue(throwError(() => ({ code: 500 })));

    deleteAddon$(actions$, service).subscribe((result) => {
      expect(result).toEqual(deleteAddonFailure({ error: 'An unexpected error occurred' }));
      done();
    });
  });
});
