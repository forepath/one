import { formatSearchTerm, parseSearch, type ParsedSearch, removeSearchTerm, setSearchFilter } from '../list-search';
import {
  replicaParts,
  workspaceAncestors,
  WORKSPACE_TABLE_KINDS,
  type WorkspaceItem,
  type WorkspaceModel,
} from '../workspace/workspace-model';
import { isCreatableKind } from './resource-modal.service';
import { RESOURCE_SEARCH_FIELDS } from './resource-tree';

/** What a Contents table lists (3.37): the whole cluster, or what lives in a site / node / project / deployment. */
export type ContentsScope =
  | { kind: 'cluster' }
  | { kind: 'site'; name: string }
  | { kind: 'node'; name: string }
  | { kind: 'project'; name: string }
  | { kind: 'deployment'; project: string; name: string };

function inPlace(model: WorkspaceModel, item: WorkspaceItem, containerId: string, placement: string): boolean {
  return item.placement === placement || workspaceAncestors(model, item.id).includes(containerId);
}

/** The rows of a scope: the table kinds (a deployment's replicas for `deployment`), without the scope object itself. */
export function contentsRows(model: WorkspaceModel, scope: ContentsScope): WorkspaceItem[] {
  const rows = (predicate: (item: WorkspaceItem) => boolean, kinds = WORKSPACE_TABLE_KINDS) =>
    model.items.filter((item) => kinds.has(item.kind) && predicate(item));

  switch (scope.kind) {
    case 'cluster':
      return rows(() => true);
    case 'site': {
      const siteId = `site:${scope.name}`;
      const nodes = new Set(
        model.items.filter((i) => i.kind === 'node' && i.placement === scope.name).map((i) => i.label),
      );

      return rows(
        (item) =>
          item.id !== siteId &&
          (inPlace(model, item, siteId, scope.name) || (!!item.placement && nodes.has(item.placement))),
      );
    }
    case 'node': {
      const nodeId = `node:${scope.name}`;

      return rows((item) => item.id !== nodeId && item.kind !== 'site' && inPlace(model, item, nodeId, scope.name));
    }
    case 'project':
      return rows((item) => item.project === scope.name);
    case 'deployment':
      return rows(
        (item) => {
          if (item.project !== scope.project) return false;

          if (item.kind === 'replica') return replicaParts(item.id).deployment === scope.name;

          return item.data['deployment'] === scope.name && item.kind !== 'deployment';
        },
        new Set(['replica', 'service', 'volume']),
      );
  }
}

/**
 * The search a Contents table starts with: `?q=` plus the filters links carry (`?kind=`, `?project=`, `?status=`,
 * comma-separated), merged into one `SearchSyntax` query.
 */
export function contentsQueryFromParams(params: Readonly<Record<string, string | null | undefined>>): string {
  let query = params['q']?.trim() ?? '';

  for (const field of ['kind', 'project', 'status'] as const)
    for (const value of (params[field] ?? '').split(',').filter(Boolean))
      query = setSearchFilter(query, field, value, { append: true, fields: RESOURCE_SEARCH_FIELDS });

  return query;
}

/** Removes one chip's term from the query. */
export function removeContentsTerm(query: string, chipId: string): string {
  const term = parseSearch(query, RESOURCE_SEARCH_FIELDS).terms.find((t) => formatSearchTerm(t) === chipId);

  return term ? removeSearchTerm(query, term, RESOURCE_SEARCH_FIELDS) : query;
}

/**
 * The one creatable kind a Contents table is filtered to (`kind:Policy`, the Policies tab, `?kind=BackupTarget`), with
 * the project new resources start in — the table-head "+" of single-kind tables (2026-10-29). Mixed kinds: null (the
 * top-bar "+" covers them).
 */
export function contentsCreateTarget(
  parsed: ParsedSearch,
  scope: ContentsScope,
  kinds: readonly string[],
): { kind: string; project: string | null } | null {
  if (scope.kind !== 'cluster' && scope.kind !== 'project') return null;

  const kindTerms = parsed.filters.filter((t) => t.field?.toLowerCase() === 'kind');

  if (kindTerms.length !== 1 || kindTerms[0].negated) return null;

  const kind = kinds.find((k) => k.toLowerCase() === kindTerms[0].value.toLowerCase());

  if (!kind || !isCreatableKind(kind)) return null;

  if (scope.kind === 'project') return { kind, project: scope.name };

  const projects = parsed.filters.filter((t) => t.field?.toLowerCase() === 'project' && !t.negated);

  return { kind, project: projects.length === 1 ? projects[0].value : null };
}
