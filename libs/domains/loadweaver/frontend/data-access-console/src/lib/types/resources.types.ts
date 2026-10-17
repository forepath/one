/** Declarative resources (3.29): `GET /resources`, `GET /resources/{kind}/{name}`, `GET /schemas[/{kind}]`. */

export interface ResourceMetadata {
  name: string;
  /** Owning project; absent for cluster-level resources (3.17). */
  project?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/** One resource of the desired state, as stored (defaults applied). */
export interface ConsoleResource<S = Record<string, unknown>> {
  apiVersion: string;
  kind: string;
  metadata: ResourceMetadata;
  spec: S;
}

/** Identifies a resource: kind, name and the project (null for cluster-level resources). */
export interface ResourceKey {
  kind: string;
  name: string;
  project: string | null;
}

/** `GET /schemas`: every kind with its description. */
export interface ResourceKindInfo {
  kind: string;
  description: string;
}

/** A JSON Schema (draft 2020-12) as published by `GET /schemas/{kind}`, and its violations. */
export type { JsonSchema, JsonSchemaIssue, JsonSchemaObject } from '@forepath/loadweaver/shared/util-json-schema';
