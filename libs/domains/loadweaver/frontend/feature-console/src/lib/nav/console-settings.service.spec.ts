import { TestBed } from '@angular/core/testing';
import { ConsoleSavedViewsService, type SavedView } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcDensityService } from '@forepath/shared/frontend/ui-components';
import { of, throwError } from 'rxjs';

import { ConsoleSettingsService } from './console-settings.service';

describe('ConsoleSettingsService', () => {
  const view = (state: Record<string, unknown>): SavedView => ({
    id: 'v1',
    scope: 'settings',
    name: 'console',
    state,
    createdAt: '2026-10-27T00:00:00Z',
    updatedAt: '2026-10-27T00:00:00Z',
  });
  let views: { list: jest.Mock; create: jest.Mock; update: jest.Mock };

  function setup(): { settings: ConsoleSettingsService; density: FpcDensityService } {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: ConsoleSavedViewsService, useValue: views }] });

    return { settings: TestBed.inject(ConsoleSettingsService), density: TestBed.inject(FpcDensityService) };
  }

  beforeEach(() => {
    views = {
      list: jest.fn(() => of([view({ density: 'comfortable' })])),
      create: jest.fn((body) => of(view(body.state))),
      update: jest.fn((_id, body) => of(view(body.state))),
    };
  });

  it('keeps the density fixed compact and ignores a stored density', () => {
    localStorage.setItem('fpc.density', 'comfortable');
    TestBed.configureTestingModule({ providers: [{ provide: ConsoleSavedViewsService, useValue: views }] });
    const settings = TestBed.inject(ConsoleSettingsService);
    const density = TestBed.inject(FpcDensityService);

    expect(density.density()).toBe('compact');
    settings.load();
    expect(views.list).toHaveBeenCalledWith('settings');
    expect(density.density()).toBe('compact');
    expect(settings.state()).toEqual({ density: 'comfortable' });
  });

  it('updates the same record on a change', () => {
    const { settings } = setup();

    settings.load();
    settings.patch({ treeView: 'kind' });
    expect(views.update).toHaveBeenCalledWith('v1', { state: { density: 'comfortable', treeView: 'kind' } });
  });

  it('creates the record on the first change and survives a failing load', () => {
    views.list.mockReturnValue(throwError(() => new Error('403')));
    const { settings, density } = setup();

    settings.load();
    expect(density.density()).toBe('compact');

    settings.patch({ treeView: 'kind' });
    expect(views.create).toHaveBeenCalledWith({ scope: 'settings', name: 'console', state: { treeView: 'kind' } });
  });
});
