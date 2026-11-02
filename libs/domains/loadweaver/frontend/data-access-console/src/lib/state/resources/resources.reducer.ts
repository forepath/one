import { createReducer, on } from '@ngrx/store';

import type { ConsoleResource, JsonSchema, ResourceKey, ResourceKindInfo } from '../../types/resources.types';
import {
  clearResourcePlanError,
  loadResource,
  loadResourceFailure,
  loadResourceKinds,
  loadResourceKindsFailure,
  loadResourceKindsSuccess,
  loadResources,
  loadResourceSchema,
  loadResourceSchemaFailure,
  loadResourceSchemaSuccess,
  loadResourcesFailure,
  loadResourcesSuccess,
  loadResourceSuccess,
  planResourceChange,
  planResourceChangeFailure,
  planResourceChangeSuccess,
} from './resources.actions';

export interface ConsoleResourcesState {
  resources: ConsoleResource[];
  loading: boolean;
  error: string | null;
  kinds: ResourceKindInfo[];
  kindsError: string | null;
  /** JSON Schemas per kind, read on demand. */
  schemas: Record<string, JsonSchema>;
  schemaErrors: Record<string, string>;
  selectedKey: ResourceKey | null;
  selected: ConsoleResource | null;
  selectedLoading: boolean;
  selectedError: string | null;
  /** A plan is being created from the editor. */
  planning: boolean;
  planError: string | null;
}

export const initialConsoleResourcesState: ConsoleResourcesState = {
  resources: [],
  loading: false,
  error: null,
  kinds: [],
  kindsError: null,
  schemas: {},
  schemaErrors: {},
  selectedKey: null,
  selected: null,
  selectedLoading: false,
  selectedError: null,
  planning: false,
  planError: null,
};

export function sameResourceKey(a: ResourceKey | null, b: ResourceKey | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.name === b.name && (a.project ?? null) === (b.project ?? null);
}

export function resourceKeyOfResource(resource: ConsoleResource<unknown>): ResourceKey {
  return { kind: resource.kind, name: resource.metadata.name, project: resource.metadata.project ?? null };
}

export const consoleResourcesReducer = createReducer(
  initialConsoleResourcesState,
  on(loadResources, (state, { silent }) => ({ ...state, loading: !silent, error: null })),
  on(loadResourcesSuccess, (state, { resources }) => ({ ...state, resources, loading: false })),
  on(loadResourcesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(loadResource, (state, { key }) => ({
    ...state,
    selectedKey: key,
    selected: sameResourceKey(state.selectedKey, key)
      ? state.selected
      : (state.resources.find((r) => sameResourceKey(resourceKeyOfResource(r), key)) ?? null),
    selectedLoading: true,
    selectedError: null,
    planError: null,
  })),
  on(loadResourceSuccess, (state, { resource }) =>
    sameResourceKey(state.selectedKey, resourceKeyOfResource(resource))
      ? { ...state, selected: resource, selectedLoading: false }
      : state,
  ),
  on(loadResourceFailure, (state, { key, error }) =>
    sameResourceKey(state.selectedKey, key)
      ? { ...state, selected: null, selectedLoading: false, selectedError: error }
      : state,
  ),
  on(loadResourceKinds, (state) => ({ ...state, kindsError: null })),
  on(loadResourceKindsSuccess, (state, { kinds }) => ({ ...state, kinds })),
  on(loadResourceKindsFailure, (state, { error }) => ({ ...state, kindsError: error })),
  on(loadResourceSchema, (state, { kind }) => {
    const schemaErrors = { ...state.schemaErrors };

    delete schemaErrors[kind];

    return { ...state, schemaErrors };
  }),
  on(loadResourceSchemaSuccess, (state, { kind, schema }) => ({
    ...state,
    schemas: { ...state.schemas, [kind]: schema },
  })),
  on(loadResourceSchemaFailure, (state, { kind, error }) => ({
    ...state,
    schemaErrors: { ...state.schemaErrors, [kind]: error },
  })),
  on(planResourceChange, (state) => ({ ...state, planning: true, planError: null })),
  on(planResourceChangeSuccess, (state) => ({ ...state, planning: false })),
  on(planResourceChangeFailure, (state, { error }) => ({ ...state, planning: false, planError: error })),
  on(clearResourcePlanError, (state) => ({ ...state, planError: null })),
);
