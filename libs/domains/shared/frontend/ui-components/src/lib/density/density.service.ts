import { DOCUMENT } from '@angular/common';
import { EnvironmentProviders, Injectable, effect, inject, provideEnvironmentInitializer, signal } from '@angular/core';

/** `compact` (the default) tightens rows of tables, trees, lists, lanes and headers; `comfortable` restores the roomy spacing. */
export type FpcDensity = 'compact' | 'comfortable';

export const FPC_DENSITY_STORAGE_KEY = 'fpc.density';

/** The CSS class set on `<body>` while the density is `compact`; `styles/_density.scss` reads it. */
export const FPC_DENSITY_COMPACT_CLASS = 'fpc-density-compact';

export function fpcParseDensity(value: unknown): FpcDensity | null {
  return value === 'compact' || value === 'comfortable' ? value : null;
}

/**
 * App-wide density. Compact by default; the choice is kept in `localStorage` so the first paint
 * matches, and apps that persist per-user settings server-side call `set()` once they are loaded.
 */
@Injectable({ providedIn: 'root' })
export class FpcDensityService {
  private readonly document = inject(DOCUMENT);
  private readonly state = signal<FpcDensity>(this.readStored() ?? 'compact');

  readonly density = this.state.asReadonly();

  constructor() {
    effect(() => {
      const compact = this.state() === 'compact';
      this.document.body?.classList.toggle(FPC_DENSITY_COMPACT_CLASS, compact);
    });
  }

  isCompact(): boolean {
    return this.state() === 'compact';
  }

  set(density: FpcDensity): void {
    this.state.set(density);
    this.writeStored(density);
  }

  toggle(): FpcDensity {
    const next: FpcDensity = this.state() === 'compact' ? 'comfortable' : 'compact';
    this.set(next);

    return next;
  }

  private readStored(): FpcDensity | null {
    try {
      return fpcParseDensity(this.document.defaultView?.localStorage?.getItem(FPC_DENSITY_STORAGE_KEY));
    } catch {
      return null;
    }
  }

  private writeStored(density: FpcDensity): void {
    try {
      this.document.defaultView?.localStorage?.setItem(FPC_DENSITY_STORAGE_KEY, density);
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still applies.
    }
  }
}

/**
 * Applies the stored / default density at app start (DB-22, 2026-10-29). Without it the body class only appeared once a
 * table, tree or object header injected the service, so pages without one (security settings, file explorer, empty
 * pages) rendered comfortable headers (71 px instead of 55 px). Add to every console's `app.config.ts`.
 */
export function provideFpcDensity(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(FpcDensityService);
  });
}
