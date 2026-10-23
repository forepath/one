import { createAction, props } from '@ngrx/store';

import type { CreatePlanRequest, Plan } from '../../types/plans.types';
import type { ConsoleResource, JsonSchema, ResourceKey, ResourceKindInfo } from '../../types/resources.types';

export const loadResources = createAction('[ConsoleResources] Load', props<{ silent?: boolean }>());
export const loadResourcesSuccess = createAction(
  '[ConsoleResources] Load Success',
  props<{ resources: ConsoleResource[] }>(),
);
export const loadResourcesFailure = createAction('[ConsoleResources] Load Failure', props<{ error: string }>());

export const loadResource = createAction('[ConsoleResources] Load Resource', props<{ key: ResourceKey }>());
export const loadResourceSuccess = createAction(
  '[ConsoleResources] Load Resource Success',
  props<{ resource: ConsoleResource }>(),
);
export const loadResourceFailure = createAction(
  '[ConsoleResources] Load Resource Failure',
  props<{ key: ResourceKey; error: string }>(),
);

export const loadResourceKinds = createAction('[ConsoleResources] Load Kinds');
export const loadResourceKindsSuccess = createAction(
  '[ConsoleResources] Load Kinds Success',
  props<{ kinds: ResourceKindInfo[] }>(),
);
export const loadResourceKindsFailure = createAction(
  '[ConsoleResources] Load Kinds Failure',
  props<{ error: string }>(),
);

/** The JSON Schema of a kind for the editor (read once per kind). */
export const loadResourceSchema = createAction('[ConsoleResources] Load Schema', props<{ kind: string }>());
export const loadResourceSchemaSuccess = createAction(
  '[ConsoleResources] Load Schema Success',
  props<{ kind: string; schema: JsonSchema }>(),
);
export const loadResourceSchemaFailure = createAction(
  '[ConsoleResources] Load Schema Failure',
  props<{ kind: string; error: string }>(),
);

/** Saving never writes: it plans the change (`POST /plans`) and opens the plan for review. */
export const planResourceChange = createAction(
  '[ConsoleResources] Plan Change',
  props<{ request: CreatePlanRequest }>(),
);
export const planResourceChangeSuccess = createAction(
  '[ConsoleResources] Plan Change Success',
  props<{ plan: Plan }>(),
);
export const planResourceChangeFailure = createAction(
  '[ConsoleResources] Plan Change Failure',
  props<{ error: string }>(),
);
export const clearResourcePlanError = createAction('[ConsoleResources] Clear Plan Error');
