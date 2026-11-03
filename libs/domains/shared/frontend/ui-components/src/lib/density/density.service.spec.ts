import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import {
  FPC_DENSITY_COMPACT_CLASS,
  FPC_DENSITY_STORAGE_KEY,
  FpcDensityService,
  fpcParseDensity,
  provideFpcDensity,
} from './density.service';

describe('FpcDensityService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.classList.remove(FPC_DENSITY_COMPACT_CLASS);
  });

  function create(): FpcDensityService {
    const service = TestBed.inject(FpcDensityService);
    TestBed.tick();

    return service;
  }

  it('is compact by default and marks the body', () => {
    const service = create();

    expect(service.density()).toBe('compact');
    expect(document.body.classList).toContain(FPC_DENSITY_COMPACT_CLASS);
  });

  it('applies the density at app start through provideFpcDensity', () => {
    TestBed.configureTestingModule({ providers: [provideFpcDensity()] });
    // Any injection builds the environment injector, which runs the initializer (no component injects the service).
    TestBed.inject(DOCUMENT);
    TestBed.tick();

    expect(document.body.classList).toContain(FPC_DENSITY_COMPACT_CLASS);
  });

  it('restores the stored density', () => {
    localStorage.setItem(FPC_DENSITY_STORAGE_KEY, 'comfortable');
    const service = create();

    expect(service.density()).toBe('comfortable');
    expect(document.body.classList).not.toContain(FPC_DENSITY_COMPACT_CLASS);
  });

  it('toggles, persists and updates the body class', () => {
    const service = create();

    expect(service.toggle()).toBe('comfortable');
    TestBed.tick();
    expect(localStorage.getItem(FPC_DENSITY_STORAGE_KEY)).toBe('comfortable');
    expect(document.body.classList).not.toContain(FPC_DENSITY_COMPACT_CLASS);

    service.set('compact');
    TestBed.tick();
    expect(service.isCompact()).toBe(true);
    expect(document.body.classList).toContain(FPC_DENSITY_COMPACT_CLASS);
  });

  it('parses only known values', () => {
    expect(fpcParseDensity('compact')).toBe('compact');
    expect(fpcParseDensity('dense')).toBeNull();
    expect(fpcParseDensity(null)).toBeNull();
  });
});
