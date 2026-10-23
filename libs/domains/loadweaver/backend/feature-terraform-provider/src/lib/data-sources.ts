import type { BlockSchema, TfObject, TfValue } from '@forepath/loadweaver/backend/util-terraform-protocol';
import { RESOURCE_KINDS } from '@forepath/loadweaver/shared/util-model';

import { attributeError, type Diagnostic } from './diagnostics';
import { apiDiagnostics, type RunnerContext } from './plan-runner';
import { canonicalJson, definitionFor, resourceId, scopeOfKind } from './resources';

export interface DataSourceDefinition {
  typeName: string;
  schema: BlockSchema;
  read(ctx: RunnerContext, config: TfObject): Promise<{ state: TfObject | null; diagnostics: Diagnostic[] }>;
}

const projectFields = definitionFor('loadweaver_project')?.fields ?? [];

function pathValue(spec: Record<string, unknown>, path: string[]): TfValue {
  let cur: unknown = spec;

  for (const key of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined;

  return cur === undefined ? null : (cur as TfValue);
}

function projectFor(config: TfObject, ctx: RunnerContext, kind: string): string | null {
  const configured = config['project'];

  if (typeof configured === 'string') return configured || null;

  return scopeOfKind(kind) === 'project' ? ctx.settings.project : null;
}

export const DATA_SOURCE_DEFINITIONS: DataSourceDefinition[] = [
  {
    typeName: 'loadweaver_resource',
    schema: {
      version: 0,
      description: 'Reads any stored Loadweaver resource (desired state).',
      attributes: [
        { name: 'kind', type: 'string', required: true, description: 'The Loadweaver kind, e.g. `Policy`.' },
        { name: 'name', type: 'string', required: true, description: 'Resource name.' },
        {
          name: 'project',
          type: 'string',
          optional: true,
          description: 'Owning project (project kinds default to the provider project; `""` for cluster-wide).',
        },
        { name: 'id', type: 'string', computed: true, description: '`Kind/name` or `Kind/project/name`.' },
        { name: 'labels', type: ['map', 'string'], computed: true, description: 'Resource labels.' },
        { name: 'spec', type: 'string', computed: true, description: 'The stored spec as JSON (use `jsondecode`).' },
      ],
    },
    async read(ctx, config) {
      const kind = String(config['kind']);

      if (!(kind in RESOURCE_KINDS))
        return {
          state: null,
          diagnostics: [attributeError('kind', 'Unknown kind', `"${kind}" is not a Loadweaver kind.`)],
        };

      const project = projectFor(config, ctx, kind);
      const name = String(config['name']);

      try {
        const stored = await ctx.client.getResource({ kind, name, ...(project ? { project } : {}) }, ctx.signal);

        if (!stored)
          return {
            state: null,
            diagnostics: [
              attributeError(
                'name',
                'Resource not found',
                `${resourceId(kind, name, project)} does not exist or is not visible to the token.`,
              ),
            ],
          };

        return {
          state: {
            ...config,
            id: resourceId(kind, name, stored.metadata.project ?? null),
            labels: (stored.metadata.labels ?? {}) as TfObject,
            spec: canonicalJson(stored.spec),
          },
          diagnostics: [],
        };
      } catch (err) {
        return { state: null, diagnostics: apiDiagnostics(err, 'read', () => 'name') };
      }
    },
  },
  {
    typeName: 'loadweaver_project',
    schema: {
      version: 0,
      description: 'Reads a project with its defaults and quota.',
      attributes: [
        { name: 'name', type: 'string', required: true, description: 'Project name.' },
        { name: 'id', type: 'string', computed: true, description: '`Project/name`.' },
        { name: 'labels', type: ['map', 'string'], computed: true, description: 'Project labels.' },
        ...projectFields.map((f) => ({
          name: f.attribute.name,
          type: f.attribute.type,
          computed: true,
          description: f.attribute.description,
        })),
      ],
    },
    async read(ctx, config) {
      const name = String(config['name']);

      try {
        const stored = await ctx.client.getResource({ kind: 'Project', name }, ctx.signal);

        if (!stored)
          return {
            state: null,
            diagnostics: [
              attributeError(
                'name',
                'Project not found',
                `Project ${name} does not exist or is not visible to the token.`,
              ),
            ],
          };

        const spec = (stored.spec ?? {}) as Record<string, unknown>;

        return {
          state: {
            name,
            id: resourceId('Project', name, null),
            labels: (stored.metadata.labels ?? {}) as TfObject,
            ...Object.fromEntries(projectFields.map((f) => [f.attribute.name, pathValue(spec, f.path)])),
          },
          diagnostics: [],
        };
      } catch (err) {
        return { state: null, diagnostics: apiDiagnostics(err, 'read', () => 'name') };
      }
    },
  },
  {
    typeName: 'loadweaver_deployment_status',
    schema: {
      version: 0,
      description:
        'Where a deployment runs: replicas with node, state and addresses, and the stable service addresses.',
      attributes: [
        { name: 'name', type: 'string', required: true, description: 'Deployment name.' },
        { name: 'project', type: 'string', optional: true, description: 'Project (default: the provider project).' },
        { name: 'id', type: 'string', computed: true, description: '`Deployment/project/name`.' },
        {
          name: 'replicas',
          type: [
            'list',
            [
              'object',
              { id: 'string', service: 'string', node: 'string', state: 'string', addresses: ['list', 'string'] },
            ],
          ],
          computed: true,
          description: 'Replicas (cron runs excluded).',
        },
        {
          name: 'services',
          type: ['list', ['object', { name: 'string', address_v4: 'string', address_v6: 'string' }]],
          computed: true,
          description: 'Service addresses, stable across restarts, migrations and failover.',
        },
      ],
    },
    async read(ctx, config) {
      const project = projectFor(config, ctx, 'Deployment');
      const name = String(config['name']);

      if (!project)
        return {
          state: null,
          diagnostics: [attributeError('project', 'Missing project', 'Set project here or in the provider block.')],
        };

      try {
        const status = await ctx.client.deploymentStatus(project, name, ctx.signal);

        return {
          state: {
            name,
            project,
            id: resourceId('Deployment', name, project),
            replicas: status.replicas.map((r) => ({
              id: r.id,
              service: r.service,
              node: r.node,
              state: r.state,
              addresses: r.addresses ?? [],
            })),
            services: status.services.map((s) => ({ name: s.name, address_v4: s.addressV4, address_v6: s.addressV6 })),
          },
          diagnostics: [],
        };
      } catch (err) {
        return { state: null, diagnostics: apiDiagnostics(err, 'read', () => 'name') };
      }
    },
  },
];
