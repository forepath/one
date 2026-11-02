import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  inject,
  InjectionToken,
  input,
  type Signal,
} from '@angular/core';
import { type ActivatedRoute, convertToParamMap, type ParamMap } from '@angular/router';
import { type Observable, of } from 'rxjs';

/**
 * The object scope of a section page embedded in an object tab (3.38 "link-only object tabs are embedded"): the
 * query / route parameters the page would otherwise read from its URL (`project`, `deployment`, `node`, `q`, …).
 *
 * Contract for embeddable section pages:
 * - read presets through `sectionQuery()` / `sectionQuery$()` instead of the route (embedded → the scope);
 * - never write the URL while embedded (`fpcListQueryState({ url: scope ? false : … })`, no `router.navigate([], …)`);
 * - hide pickers the scope fixes (project, node, deployment) and the routed `fpc-page-header` title (the object header
 *   above already names the object); actions the page needs move into its toolbar strip / lane header.
 */
export interface LoadweaverSectionScope {
  readonly params: Signal<Readonly<Record<string, string>>>;
}

export const LW_SECTION_SCOPE = new InjectionToken<LoadweaverSectionScope>('LW_SECTION_SCOPE');

/** The object scope when the page is embedded in an object tab, else `null` (call in an injection context). */
export function injectSectionScope(): LoadweaverSectionScope | null {
  return inject(LW_SECTION_SCOPE, { optional: true });
}

/** The parameters a section page starts from: the embedding object's scope, else the route's query parameters. */
export function sectionQuery(route: ActivatedRoute, scope: LoadweaverSectionScope | null): ParamMap {
  return scope ? convertToParamMap(scope.params()) : route.snapshot.queryParamMap;
}

/** Like `sectionQuery()` as a stream (the scope is fixed per embedded instance). */
export function sectionQuery$(route: ActivatedRoute, scope: LoadweaverSectionScope | null): Observable<ParamMap> {
  return scope ? of(convertToParamMap(scope.params())) : route.queryParamMap;
}

/** Route parameters (`:project`, …): the scope's values when embedded, else the route's. */
export function sectionParams$(route: ActivatedRoute, scope: LoadweaverSectionScope | null): Observable<ParamMap> {
  return scope ? of(convertToParamMap(scope.params())) : route.paramMap;
}

/**
 * Provides `LW_SECTION_SCOPE` to the projected section page. The object page keys it by the scope, so a new object or
 * tab creates a fresh page (pages read their presets once).
 */
@Component({
  selector: 'loadweaver-scoped-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: LW_SECTION_SCOPE, useExisting: forwardRef(() => LoadweaverScopedSectionComponent) }],
  host: { class: 'lw-scoped-section d-flex flex-column flex-grow-1 min-h-0' },
  template: `<ng-content />`,
  // The projected page host fills the tab body like a routed host (`.fpc-routed-outlet > router-outlet + *`): page hosts
  // without their own flex classes (terminals, DNS, …) otherwise stay `display: block` and their body collapses.
  styles: `
    :host > ::ng-deep * {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
    }
  `,
})
export class LoadweaverScopedSectionComponent implements LoadweaverSectionScope {
  readonly params = input.required<Readonly<Record<string, string>>>();
}
