import {
  containsUnknown,
  isUnknown,
  tfEqual,
  UNKNOWN,
  type TfObject,
} from '@forepath/loadweaver/backend/util-terraform-protocol';
import { RESOURCE_KINDS } from '@forepath/loadweaver/shared/util-model';

import type { ResourceRefInput } from './api-client';
import { attributeError, error, hasErrors, type Diagnostic } from './diagnostics';
import { apiDiagnostics, createAndApply, dryRun, planInputFor, type RunnerContext } from './plan-runner';
import {
  attributeForIssue,
  definitionFor,
  documentFromState,
  fillUnknowns,
  hasProjectAttribute,
  kindOf,
  resourceId,
  scopeOfKind,
  stateFromServer,
  validateDocument,
  type ResourceDefinition,
} from './resources';

const NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** Attributes whose change replaces the resource (a new Loadweaver resource, the old one deleted). */
const REPLACING = ['kind', 'name', 'project'];
const COMPUTED_ONLY = new Set(['id', 'last_plan_id']);

function refOf(def: ResourceDefinition, state: TfObject): ResourceRefInput | null {
  const kind = kindOf(def, state);
  const name = state['name'];
  const project = state['project'];

  if (!kind || typeof name !== 'string') return null;

  return { kind, name, ...(typeof project === 'string' && project !== '' ? { project } : {}) };
}

/** The state as a resource document, without the computed parts (which may still be unknown at plan time). */
function configPart(def: ResourceDefinition, state: TfObject): TfObject {
  const out: TfObject = {};

  for (const [key, value] of Object.entries(state)) {
    if (COMPUTED_ONLY.has(key)) continue;

    const field = def.fields?.find((f) => f.attribute.name === key);

    out[key] = field?.attribute.computed && isUnknown(value) ? null : value;
  }

  return out;
}

/** Static checks on the configuration (ValidateResourceConfig): names, JSON spec, the kind's schema. */
export function validateResourceConfig(def: ResourceDefinition, config: TfObject | null): Diagnostic[] {
  if (!config) return [];

  const diags: Diagnostic[] = [];
  const name = config['name'];

  if (typeof name === 'string' && !NAME_PATTERN.test(name))
    diags.push(
      attributeError('name', 'Invalid name', 'Names are lowercase RFC 1123 labels: a-z, 0-9 and "-", 1-63 characters.'),
    );

  const project = config['project'];

  if (typeof project === 'string' && project !== '' && !NAME_PATTERN.test(project))
    diags.push(attributeError('project', 'Invalid project', 'Project names are lowercase RFC 1123 labels.'));

  const kind = config['kind'];

  if (def.kind === null && typeof kind === 'string' && !(kind in RESOURCE_KINDS))
    diags.push(
      attributeError(
        'kind',
        'Unknown kind',
        `"${kind}" is not a Loadweaver kind. Known: ${Object.keys(RESOURCE_KINDS).join(', ')}.`,
      ),
    );

  if (!def.fields && typeof config['spec'] === 'string') {
    try {
      const parsed = JSON.parse(config['spec']) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        diags.push(attributeError('spec', 'Invalid spec', 'spec must be a JSON object, e.g. jsonencode({ ... }).'));
    } catch (err) {
      diags.push(attributeError('spec', 'Invalid spec', `spec is not valid JSON: ${(err as Error).message}`));
    }
  }

  return diags;
}

function resolveProject(
  def: ResourceDefinition,
  planned: TfObject,
  config: TfObject,
  prior: TfObject | null,
  defaultProject: string | null,
): Diagnostic[] {
  if (!hasProjectAttribute(def)) return [];

  const kind = kindOf(def, planned);
  const scope = kind ? scopeOfKind(kind) : null;
  const configured = config['project'];

  if (configured === null || configured === undefined) {
    if (
      prior &&
      typeof prior['project'] === 'string' &&
      (def.kind !== null || tfEqual(prior['kind'], planned['kind']))
    ) {
      planned['project'] = prior['project'];
    } else if (scope === 'cluster') {
      planned['project'] = '';
    } else if (scope === 'project') {
      if (!defaultProject)
        return [
          attributeError(
            'project',
            'Missing project',
            `${kind} resources belong to a project: set project here or in the provider block (or LOADWEAVER_PROJECT).`,
          ),
        ];

      planned['project'] = defaultProject;
    } else {
      planned['project'] = scope ? (defaultProject ?? '') : UNKNOWN;
    }
  } else if (typeof configured === 'string' && scope === 'cluster' && configured !== '') {
    return [attributeError('project', 'Cluster-level kind', `${kind} is a cluster-level resource and has no project.`)];
  } else if (typeof configured === 'string' && scope === 'project' && configured === '') {
    return [attributeError('project', 'Missing project', `${kind} resources belong to a project.`)];
  }

  return [];
}

export interface PlanResult {
  planned: TfObject | null;
  requiresReplace: string[];
  diagnostics: Diagnostic[];
}

/**
 * PlanResourceChange. The planned state is the configuration plus computed values; a change is checked locally
 * with the control plane's schema and then, with `dry_run`, as a Loadweaver plan that is discarded again (its
 * refusals become errors, its network / workload effects, pins and approval risk a warning).
 */
export async function planResourceChange(
  def: ResourceDefinition,
  ctx: RunnerContext | null,
  input: { prior: TfObject | null; proposed: TfObject | null; config: TfObject | null },
): Promise<PlanResult> {
  const { prior, proposed, config } = input;

  if (!proposed) {
    const ref = prior ? refOf(def, prior) : null;
    const diagnostics = ctx?.settings.dryRun && ref ? await dryRun(ctx, { delete: [ref] }, () => 'name') : [];

    return { planned: null, requiresReplace: [], diagnostics };
  }

  const planned: TfObject = { ...proposed };
  const diagnostics = resolveProject(def, planned, config ?? {}, prior, ctx?.settings.project ?? null);

  for (const field of def.fields ?? [])
    if (
      field.attribute.computed &&
      (planned[field.attribute.name] === null || planned[field.attribute.name] === undefined)
    )
      planned[field.attribute.name] = UNKNOWN;

  const kind = kindOf(def, planned);
  const name = planned['name'];
  const project = hasProjectAttribute(def) ? planned['project'] : '';

  planned['id'] =
    kind && typeof name === 'string' && typeof project === 'string' ? resourceId(kind, name, project || null) : UNKNOWN;

  const changed =
    !prior || Object.keys(planned).some((key) => key !== 'last_plan_id' && !tfEqual(planned[key], prior[key]));

  planned['last_plan_id'] = changed ? UNKNOWN : (prior?.['last_plan_id'] ?? null);

  const requiresReplace = prior ? REPLACING.filter((key) => key in planned && !tfEqual(planned[key], prior[key])) : [];

  if (!changed || hasErrors(diagnostics))
    return { planned: changed ? planned : { ...prior }, requiresReplace, diagnostics };

  const docState = configPart(def, planned);

  if (containsUnknown(docState)) return { planned, requiresReplace, diagnostics };

  const doc = documentFromState(def, docState);

  if (doc.ok === false)
    return {
      planned,
      requiresReplace,
      diagnostics: [...diagnostics, attributeError(doc.attribute, 'Invalid configuration', doc.message)],
    };

  const validated = validateDocument(doc.resource);

  if (!validated.resource)
    return {
      planned,
      requiresReplace,
      diagnostics: [
        ...diagnostics,
        ...validated.issues.map((issue) =>
          attributeError(
            attributeForIssue(def, issue.path),
            `Invalid ${doc.resource.kind}`,
            `${issue.path}: ${issue.message}`,
          ),
        ),
      ],
    };

  if (ctx?.settings.dryRun)
    diagnostics.push(...(await dryRun(ctx, planInputFor(doc.resource), (path) => attributeForIssue(def, path))));

  return { planned, requiresReplace, diagnostics };
}

export interface ApplyResult {
  newState: TfObject | null;
  diagnostics: Diagnostic[];
}

/** ApplyResourceChange: one Loadweaver plan per resource change, applied and followed until it settled. */
export async function applyResourceChange(
  def: ResourceDefinition,
  ctx: RunnerContext,
  input: { prior: TfObject | null; planned: TfObject | null },
): Promise<ApplyResult> {
  const { prior, planned } = input;

  if (!planned) {
    const ref = prior ? refOf(def, prior) : null;

    if (!ref) return { newState: null, diagnostics: [] };

    try {
      if (!(await ctx.client.getResource(ref, ctx.signal))) return { newState: null, diagnostics: [] };
    } catch (err) {
      return { newState: prior, diagnostics: apiDiagnostics(err, 'read', () => 'name') };
    }

    const outcome = await createAndApply(ctx, { delete: [ref] }, () => 'name');

    return outcome.ok
      ? { newState: null, diagnostics: outcome.diagnostics }
      : { newState: prior, diagnostics: outcome.diagnostics };
  }

  const doc = documentFromState(def, configPart(def, planned));

  if (doc.ok === false)
    return { newState: prior, diagnostics: [attributeError(doc.attribute, 'Invalid configuration', doc.message)] };

  const attributeFor = (path: string) => attributeForIssue(def, path);
  const outcome = await createAndApply(ctx, planInputFor(doc.resource), attributeFor);

  if (outcome.ok === false) return { newState: prior, diagnostics: outcome.diagnostics };

  const ref = refOf(def, planned);
  let stored = null;

  try {
    stored = ref ? await ctx.client.getResource(ref, ctx.signal) : null;
  } catch (err) {
    return {
      newState: prior,
      diagnostics: [...outcome.diagnostics, ...apiDiagnostics(err, 'read after apply', attributeFor)],
    };
  }

  if (!stored)
    return {
      newState: prior,
      diagnostics: [
        ...outcome.diagnostics,
        error(
          'Resource missing after apply',
          `Plan ${outcome.plan.id} was applied, but ${doc.resource.kind} ${doc.resource.metadata.name} cannot be read back.`,
        ),
      ],
    };

  const fromServer = stateFromServer(def, { ...planned }, stored);
  const newState = fillUnknowns(
    { ...planned, last_plan_id: isUnknown(planned['last_plan_id']) ? outcome.plan.id : planned['last_plan_id'] },
    fromServer,
  );

  return { newState, diagnostics: outcome.diagnostics };
}

/** ReadResource: refreshes the state from the stored resource; a deleted resource leaves the state. */
export async function readResource(
  def: ResourceDefinition,
  ctx: RunnerContext,
  current: TfObject | null,
): Promise<ApplyResult> {
  if (!current) return { newState: null, diagnostics: [] };

  const ref = refOf(def, current);

  if (!ref) return { newState: current, diagnostics: [] };

  try {
    const stored = await ctx.client.getResource(ref, ctx.signal);

    return { newState: stored ? stateFromServer(def, current, stored) : null, diagnostics: [] };
  } catch (err) {
    return { newState: current, diagnostics: apiDiagnostics(err, 'read', () => 'name') };
  }
}

/**
 * ImportResourceState. IDs: `name` (cluster kinds), `project/name` (project kinds; `name` alone uses the provider
 * project), and for `loadweaver_resource` the kind first: `Kind/name` or `Kind/project/name`. The rest of the state
 * comes from the read that follows.
 */
export function importResourceState(
  def: ResourceDefinition,
  id: string,
  attributes: string[],
  defaultProject: string | null,
): { state: TfObject | null; diagnostics: Diagnostic[] } {
  const parts = id.split('/');
  let kind = def.kind as string | null;

  if (def.kind === null) {
    kind = parts.shift() ?? null;

    if (!kind || !(kind in RESOURCE_KINDS))
      return {
        state: null,
        diagnostics: [error('Invalid import ID', `Expected Kind/name or Kind/project/name, got "${id}".`)],
      };
  }

  const scope = scopeOfKind(kind as string);
  let project: string | null = null;
  let name: string | undefined;

  if (parts.length === 2) [project, name] = parts;
  else if (parts.length === 1) {
    name = parts[0];
    project = scope === 'project' ? defaultProject : null;
  }

  if (!name || !NAME_PATTERN.test(name) || (project !== null && !NAME_PATTERN.test(project)))
    return {
      state: null,
      diagnostics: [
        error(
          'Invalid import ID',
          def.kind === null
            ? `Expected Kind/name or Kind/project/name, got "${id}".`
            : scope === 'cluster'
              ? `Expected the ${kind} name, got "${id}".`
              : `Expected project/name (or name with the provider project), got "${id}".`,
        ),
      ],
    };

  if (scope === 'cluster' && project)
    return {
      state: null,
      diagnostics: [error('Invalid import ID', `${kind} is a cluster-level resource; import it by name.`)],
    };

  if (scope === 'project' && !project)
    return {
      state: null,
      diagnostics: [error('Invalid import ID', `${kind} belongs to a project: use project/name.`)],
    };

  const state: TfObject = Object.fromEntries(attributes.map((a) => [a, null]));

  state['id'] = resourceId(kind as string, name, project);
  state['name'] = name;

  if (def.kind === null) state['kind'] = kind;

  if (hasProjectAttribute(def)) state['project'] = project ?? '';

  return { state, diagnostics: [] };
}

export { definitionFor };
