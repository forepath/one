import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';

import type { CreatePlanRequest } from '../../types/plans.types';
import type { ResourceKey } from '../../types/resources.types';
import {
  clearResourcePlanError,
  loadResource,
  loadResourceKinds,
  loadResources,
  loadResourceSchema,
  planResourceChange,
} from './resources.actions';
import {
  selectResourceCounts,
  selectResourceKinds,
  selectResourceKindsError,
  selectResourcePlanError,
  selectResourcePlanning,
  selectResourceProjects,
  selectResources,
  selectResourceSchemaErrors,
  selectResourceSchemas,
  selectResourcesError,
  selectResourcesLoading,
  selectSelectedResource,
  selectSelectedResourceError,
  selectSelectedResourceLoading,
} from './resources.selectors';

@Injectable()
export class ConsoleResourcesFacade {
  private readonly store = inject(Store);

  readonly resources$ = this.store.select(selectResources);
  readonly loading$ = this.store.select(selectResourcesLoading);
  readonly error$ = this.store.select(selectResourcesError);
  readonly projects$ = this.store.select(selectResourceProjects);
  readonly counts$ = this.store.select(selectResourceCounts);
  readonly kinds$ = this.store.select(selectResourceKinds);
  readonly kindsError$ = this.store.select(selectResourceKindsError);
  readonly schemas$ = this.store.select(selectResourceSchemas);
  readonly schemaErrors$ = this.store.select(selectResourceSchemaErrors);
  readonly selected$ = this.store.select(selectSelectedResource);
  readonly selectedLoading$ = this.store.select(selectSelectedResourceLoading);
  readonly selectedError$ = this.store.select(selectSelectedResourceError);
  readonly planning$ = this.store.select(selectResourcePlanning);
  readonly planError$ = this.store.select(selectResourcePlanError);

  /** `silent`: refresh without the loading state. */
  load(silent = false): void {
    this.store.dispatch(loadResources({ silent }));
  }

  open(key: ResourceKey): void {
    this.store.dispatch(loadResource({ key }));
  }

  loadKinds(): void {
    this.store.dispatch(loadResourceKinds());
  }

  /** Reads the kind's JSON Schema unless it was read already. */
  loadSchema(kind: string): void {
    this.store.dispatch(loadResourceSchema({ kind }));
  }

  /** Plans the change (documents and / or deletions); on success the plan opens. */
  plan(request: CreatePlanRequest): void {
    this.store.dispatch(planResourceChange({ request }));
  }

  clearPlanError(): void {
    this.store.dispatch(clearResourcePlanError());
  }
}
