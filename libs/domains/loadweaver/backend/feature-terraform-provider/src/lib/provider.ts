import {
  blockType,
  decodeDynamicValue,
  encodeDynamicValue,
  toProtoSchema,
  type BlockSchema,
  type DynamicValue,
  type PluginLogger,
  type ProviderHandlers,
  type ProviderRequest,
  type TfObject,
} from '@forepath/loadweaver/backend/util-terraform-protocol';

import { LoadweaverClient, nodeHttpTransport, type HttpTransport } from './api-client';
import { DATA_SOURCE_DEFINITIONS } from './data-sources';
import { error, hasErrors, type Diagnostic } from './diagnostics';
import type { RunnerContext } from './plan-runner';
import { PROVIDER_SCHEMA, resolveProviderSettings, validateProviderConfig } from './provider-config';
import {
  applyResourceChange,
  importResourceState,
  planResourceChange,
  readResource,
  validateResourceConfig,
} from './resource-engine';
import { definitionFor, RESOURCE_DEFINITIONS, resourceSchema, type ResourceDefinition } from './resources';

export interface LoadweaverProviderOptions {
  /** Provider release, e.g. `1.4.0` (user agent). */
  version: string;
  logger: PluginLogger;
  env?: NodeJS.ProcessEnv;
  /** Replaces the HTTP client (tests: a mocked control plane). */
  transport?: (settings: { caCertificate: string | null }) => HttpTransport;
  sleep?: RunnerContext['sleep'];
  now?: RunnerContext['now'];
}

const CAPABILITIES = { plan_destroy: true, get_provider_schema_optional: false, move_resource_state: false };

function asObject(value: unknown): TfObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as TfObject) : null;
}

function decode(schema: BlockSchema, value: unknown): TfObject | null {
  return asObject(decodeDynamicValue(blockType(schema), (value ?? null) as DynamicValue | null));
}

function encode(schema: BlockSchema, value: TfObject | null) {
  return encodeDynamicValue(blockType(schema), value);
}

function decodeFailure(err: unknown): Diagnostic[] {
  return [error('Invalid value from Terraform', err instanceof Error ? err.message : String(err))];
}

function unknownType(kind: string, name: unknown): Diagnostic[] {
  return [error(`Unknown ${kind}`, `The Loadweaver provider has no ${kind} "${String(name)}".`)];
}

/**
 * The Loadweaver provider as `tfplugin6.Provider` handlers: schema, validation, configure, and per resource type
 * plan / apply / read / import mapped onto Loadweaver plans (see `resource-engine.ts`).
 */
export function createLoadweaverProvider(options: LoadweaverProviderOptions): {
  handlers: ProviderHandlers;
  stop(): void;
} {
  const env = options.env ?? process.env;
  const resourceSchemas = new Map(RESOURCE_DEFINITIONS.map((d) => [d.typeName, resourceSchema(d)]));
  const dataSources = new Map(DATA_SOURCE_DEFINITIONS.map((d) => [d.typeName, d]));
  const abort = new AbortController();
  let ctx: RunnerContext | null = null;

  const resourceOf = (typeName: unknown): { def: ResourceDefinition; schema: BlockSchema } | null => {
    const def = definitionFor(String(typeName));
    const schema = def && resourceSchemas.get(def.typeName);

    return def && schema ? { def, schema } : null;
  };
  const requireCtx = (): RunnerContext | Diagnostic[] =>
    ctx ?? [
      error('Provider not configured', 'The Loadweaver provider block could not be configured; see the errors above.'),
    ];

  const handlers: ProviderHandlers = {
    async GetMetadata() {
      return {
        server_capabilities: CAPABILITIES,
        resources: RESOURCE_DEFINITIONS.map((d) => ({ type_name: d.typeName })),
        data_sources: DATA_SOURCE_DEFINITIONS.map((d) => ({ type_name: d.typeName })),
      };
    },

    async GetProviderSchema() {
      return {
        provider: toProtoSchema(PROVIDER_SCHEMA),
        resource_schemas: Object.fromEntries(
          [...resourceSchemas].map(([name, schema]) => [name, toProtoSchema(schema)]),
        ),
        data_source_schemas: Object.fromEntries(
          DATA_SOURCE_DEFINITIONS.map((d) => [d.typeName, toProtoSchema(d.schema)]),
        ),
        server_capabilities: CAPABILITIES,
      };
    },

    async GetResourceIdentitySchemas() {
      return { identity_schemas: {} };
    },

    async GetFunctions() {
      return { functions: {} };
    },

    async ValidateProviderConfig(req: ProviderRequest) {
      try {
        return { diagnostics: validateProviderConfig(decode(PROVIDER_SCHEMA, req['config'])) };
      } catch (err) {
        return { diagnostics: decodeFailure(err) };
      }
    },

    async ValidateResourceConfig(req: ProviderRequest) {
      const r = resourceOf(req['type_name']);

      if (!r) return { diagnostics: unknownType('resource type', req['type_name']) };

      try {
        return { diagnostics: validateResourceConfig(r.def, decode(r.schema, req['config'])) };
      } catch (err) {
        return { diagnostics: decodeFailure(err) };
      }
    },

    async ValidateDataResourceConfig(req: ProviderRequest) {
      return {
        diagnostics: dataSources.has(String(req['type_name'])) ? [] : unknownType('data source', req['type_name']),
      };
    },

    async ConfigureProvider(req: ProviderRequest) {
      let config: TfObject | null;

      try {
        config = decode(PROVIDER_SCHEMA, req['config']);
      } catch (err) {
        return { diagnostics: decodeFailure(err) };
      }

      const { settings, diagnostics } = resolveProviderSettings(config, env);

      if (!settings || hasErrors(diagnostics)) return { diagnostics };

      const transport =
        options.transport?.({ caCertificate: settings.caCertificate }) ??
        nodeHttpTransport({ caCertificate: settings.caCertificate ?? undefined });
      const terraformVersion = typeof req['terraform_version'] === 'string' ? req['terraform_version'] : 'unknown';

      ctx = {
        client: new LoadweaverClient(
          settings.endpoint,
          settings.token,
          transport,
          `terraform-provider-loadweaver/${options.version} (terraform ${terraformVersion})`,
        ),
        settings,
        logger: options.logger,
        signal: abort.signal,
        ...(options.sleep ? { sleep: options.sleep } : {}),
        ...(options.now ? { now: options.now } : {}),
      };

      return { diagnostics };
    },

    async UpgradeResourceState(req: ProviderRequest) {
      const r = resourceOf(req['type_name']);

      if (!r) return { diagnostics: unknownType('resource type', req['type_name']) };

      const version = Number(req['version'] ?? 0);

      if (version > r.schema.version)
        return {
          diagnostics: [
            error(
              'State from a newer provider',
              `The state of this ${r.def.typeName} has schema version ${version}; this provider knows version ${r.schema.version}. Use the provider release that wrote it, or newer.`,
            ),
          ],
        };

      const raw = (req['raw_state'] ?? {}) as { json?: Uint8Array; flatmap?: Record<string, string> };

      if (!raw.json || raw.json.length === 0)
        return {
          diagnostics: [error('Unsupported state format', 'Only JSON state (Terraform 0.12 or newer) can be read.')],
        };

      try {
        // Version 0 is the only version so far: the stored JSON decodes as is (attributes no longer in the
        // schema are dropped). A later schema version adds its migration here.
        return { upgraded_state: encode(r.schema, decode(r.schema, { json: raw.json })), diagnostics: [] };
      } catch (err) {
        return { diagnostics: decodeFailure(err) };
      }
    },

    async ReadResource(req: ProviderRequest) {
      const r = resourceOf(req['type_name']);

      if (!r) return { diagnostics: unknownType('resource type', req['type_name']) };

      const c = requireCtx();

      if (Array.isArray(c)) return { new_state: req['current_state'], diagnostics: c };

      try {
        const result = await readResource(r.def, c, decode(r.schema, req['current_state']));

        return {
          new_state: encode(r.schema, result.newState),
          private: req['private'],
          diagnostics: result.diagnostics,
        };
      } catch (err) {
        return { new_state: req['current_state'], diagnostics: decodeFailure(err) };
      }
    },

    async PlanResourceChange(req: ProviderRequest) {
      const r = resourceOf(req['type_name']);

      if (!r) return { diagnostics: unknownType('resource type', req['type_name']) };

      try {
        const result = await planResourceChange(r.def, ctx, {
          prior: decode(r.schema, req['prior_state']),
          proposed: decode(r.schema, req['proposed_new_state']),
          config: decode(r.schema, req['config']),
        });

        return {
          planned_state: encode(r.schema, result.planned),
          requires_replace: result.requiresReplace.map((a) => ({ steps: [{ attribute_name: a }] })),
          planned_private: req['prior_private'],
          diagnostics: result.diagnostics,
        };
      } catch (err) {
        return { planned_state: req['proposed_new_state'], diagnostics: decodeFailure(err) };
      }
    },

    async ApplyResourceChange(req: ProviderRequest) {
      const r = resourceOf(req['type_name']);

      if (!r) return { diagnostics: unknownType('resource type', req['type_name']) };

      const c = requireCtx();

      if (Array.isArray(c)) return { new_state: req['prior_state'], diagnostics: c };

      try {
        const result = await applyResourceChange(r.def, c, {
          prior: decode(r.schema, req['prior_state']),
          planned: decode(r.schema, req['planned_state']),
        });

        return { new_state: encode(r.schema, result.newState), diagnostics: result.diagnostics };
      } catch (err) {
        return { new_state: req['prior_state'], diagnostics: decodeFailure(err) };
      }
    },

    async ImportResourceState(req: ProviderRequest) {
      const r = resourceOf(req['type_name']);

      if (!r) return { diagnostics: unknownType('resource type', req['type_name']) };

      const { state, diagnostics } = importResourceState(
        r.def,
        String(req['id'] ?? ''),
        r.schema.attributes.map((a) => a.name),
        ctx?.settings.project ?? null,
      );

      return {
        imported_resources: state ? [{ type_name: r.def.typeName, state: encode(r.schema, state) }] : [],
        diagnostics,
      };
    },

    async ReadDataSource(req: ProviderRequest) {
      const d = dataSources.get(String(req['type_name']));

      if (!d) return { diagnostics: unknownType('data source', req['type_name']) };

      const c = requireCtx();

      if (Array.isArray(c)) return { diagnostics: c };

      try {
        const config = decode(d.schema, req['config']) ?? {};
        const { state, diagnostics } = await d.read(c, config);

        return { state: encode(d.schema, state ?? config), diagnostics };
      } catch (err) {
        return { diagnostics: decodeFailure(err) };
      }
    },

    async StopProvider() {
      abort.abort();

      return {};
    },
  };

  return { handlers, stop: () => abort.abort() };
}
