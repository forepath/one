import { inject, Injectable, signal } from '@angular/core';
import { ConsoleSavedViewsService, type SavedView } from '@forepath/loadweaver/frontend/data-access-console';
import { FpcDensityService } from '@forepath/shared/frontend/ui-components';

/** Where the console keeps per-user settings: one saved view (3.37). */
export const CONSOLE_SETTINGS_SCOPE = 'settings';
export const CONSOLE_SETTINGS_NAME = 'console';

/**
 * Per-user console settings, stored server-side with the saved views (3.37): the resource tree's view and favourites.
 * Failures (e.g. through a fleet without a verified person) keep the local value. The density is not a setting any
 * more (3.38 R14, 2026-10-28): Loadweaver is always compact; a stored `density` (older settings / views) is ignored.
 */
@Injectable({ providedIn: 'root' })
export class ConsoleSettingsService {
  private readonly views = inject(ConsoleSavedViewsService);
  private record: SavedView | null = null;

  /** The stored settings (resource tree view / favourites, …); `{}` until loaded. */
  readonly state = signal<Readonly<Record<string, unknown>>>({});

  constructor() {
    // Fixed compact density (no user toggle): overrides a `comfortable` left in local storage by the former toggle.
    inject(FpcDensityService).set('compact');
  }

  load(): void {
    this.views.list(CONSOLE_SETTINGS_SCOPE).subscribe({
      next: (views) => {
        this.record = views.find((view) => view.name === CONSOLE_SETTINGS_NAME) ?? null;
        this.state.set(this.record?.state ?? {});
      },
      error: () => undefined,
    });
  }

  /** Merges `values` into the stored settings (kept locally when the server refuses). */
  patch(values: Record<string, unknown>): void {
    const state = { ...this.state(), ...values };

    this.state.set(state);
    this.persist(state);
  }

  private persist(state: Record<string, unknown>): void {
    const request = this.record
      ? this.views.update(this.record.id, { state })
      : this.views.create({ scope: CONSOLE_SETTINGS_SCOPE, name: CONSOLE_SETTINGS_NAME, state });

    request.subscribe({ next: (view) => (this.record = view), error: () => undefined });
  }
}
