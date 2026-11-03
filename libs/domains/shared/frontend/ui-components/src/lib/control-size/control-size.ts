import { InjectionToken, Provider } from '@angular/core';

/** Size tier of buttons, form controls (`fpc-form-control`, typeahead, input group, map editor) and their labels. */
export type FpcControlSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Default size of every button, form control and label without an explicit `size`. One rule across the apps: UI
 * behind an auth guard (consoles, settings, admin) is dense and uses `sm`; public UI (landing pages, docs, sign-in /
 * registration, public withdrawal) keeps `md`. Consoles set `provideFpcControlSize('sm')` in `app.config.ts`; public
 * routes inside a console override it with `providers: [provideFpcControlSize('md')]` and put
 * `class="fpc-density-comfortable"` on their root, so their controls also keep the regular height in compact density.
 */
export const FPC_CONTROL_SIZE = new InjectionToken<FpcControlSize>('FPC_CONTROL_SIZE', {
  providedIn: 'root',
  factory: () => 'md',
});

export function provideFpcControlSize(size: FpcControlSize): Provider {
  return { provide: FPC_CONTROL_SIZE, useValue: size };
}
