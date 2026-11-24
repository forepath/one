import { createHash } from 'node:crypto';

import { ACTION_CENTER_SOURCE_ITEM_LIMIT, ACTION_CENTER_VIEW_ITEM_LIMIT } from '../constants/action-center.constants';
import type { ActionCenterSilenceEntity } from '../entities/action-center-silence.entity';
import type {
  ActionCenterGroup,
  ActionCenterGroupDraft,
  ActionCenterParams,
  ActionCenterParamValue,
  ActionCenterSeverity,
  ActionCenterSilenceView,
  ActionCenterSnapshot,
  ActionCenterView,
  ActionCenterViewer,
  ActionCenterViewGroup,
  ActionCenterViewItem,
} from '../interfaces/action-center.types';

const SEVERITY_RANK: Record<ActionCenterSeverity, number> = { danger: 0, warning: 1, info: 2 };

function sanitizeParams(params: ActionCenterParams | undefined): ActionCenterParams {
  if (!params) {
    return {};
  }

  const result: Record<string, ActionCenterParamValue> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      result[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
    }
  }

  return result;
}

function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Normalizes source drafts: drops empty groups, clamps item counts, keeps one group per type (first wins). */
export function normalizeActionCenterGroups(drafts: readonly ActionCenterGroupDraft[]): ActionCenterGroup[] {
  const byType = new Map<string, ActionCenterGroup>();

  for (const draft of drafts) {
    const items = (draft.items ?? []).slice(0, ACTION_CENTER_SOURCE_ITEM_LIMIT).map((item) => ({
      id: String(item.id),
      params: sanitizeParams(item.params),
      occurredAt: toIsoOrNull(item.occurredAt),
    }));
    const total = Math.max(Number.isFinite(draft.total) ? Math.floor(draft.total) : 0, items.length);

    if (total <= 0 || byType.has(draft.type)) {
      continue;
    }

    byType.set(draft.type, {
      type: draft.type,
      category: draft.category,
      severity: draft.severity,
      kind: draft.kind,
      audience: draft.audience ?? 'administrative',
      total,
      items,
      params: sanitizeParams(draft.params),
    });
  }

  return [...byType.values()].sort(compareGroups);
}

/** Setup first, then by severity, then by type (stable order for fingerprints and the panel). */
function compareGroups(a: { kind: string; severity: ActionCenterSeverity; type: string }, b: typeof a): number {
  if (a.kind !== b.kind) {
    return a.kind === 'setup' ? -1 : 1;
  }

  const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

  return severity !== 0 ? severity : a.type.localeCompare(b.type);
}

export function fingerprintActionCenter(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

export function createActionCenterSnapshot(
  scopeKey: string,
  drafts: readonly ActionCenterGroupDraft[],
  now: Date,
): ActionCenterSnapshot {
  const groups = normalizeActionCenterGroups(drafts);

  return { scopeKey, generatedAt: now.toISOString(), fingerprint: fingerprintActionCenter(groups), groups };
}

/** Silences that apply to the viewer: their own plus everyone's, not yet expired. */
export function silencesForViewer(
  silences: readonly ActionCenterSilenceEntity[],
  viewer: ActionCenterViewer,
  now: Date,
): ActionCenterSilenceEntity[] {
  return silences.filter(
    (silence) =>
      silence.scopeKey === viewer.scopeKey &&
      (silence.userId === null || silence.userId === viewer.userId) &&
      (!silence.until || silence.until.getTime() > now.getTime()),
  );
}

export function canRemoveActionCenterSilence(silence: ActionCenterSilenceEntity, viewer: ActionCenterViewer): boolean {
  if (silence.userId === null) {
    return viewer.role === 'admin';
  }

  return silence.userId === viewer.userId;
}

function toSilenceView(silence: ActionCenterSilenceEntity, viewer: ActionCenterViewer): ActionCenterSilenceView {
  return {
    id: silence.id,
    itemType: silence.itemType,
    itemId: silence.itemId,
    audience: silence.userId === null ? 'everyone' : 'self',
    until: silence.until ? silence.until.toISOString() : null,
    createdAt: silence.createdAt.toISOString(),
    createdByUserId: silence.createdByUserId,
    removable: canRemoveActionCenterSilence(silence, viewer),
  };
}

/** Prefer the viewer's own silence (they can remove it) over an everyone silence of the same target. */
function pickSilence(
  current: ActionCenterSilenceEntity | undefined,
  next: ActionCenterSilenceEntity,
): ActionCenterSilenceEntity {
  if (!current) {
    return next;
  }

  return current.userId === null && next.userId !== null ? next : current;
}

/**
 * Whether a viewer may see a silence: never for types hidden by role / group filter; for restricted viewers (PATs)
 * item silences only for records they can see and type silences only for types they can see. Console admins and
 * managers see every silence that applies to them, including silences of types that are currently empty.
 */
function isSilenceVisible(
  silence: ActionCenterSilenceEntity,
  viewer: ActionCenterViewer,
  hiddenTypes: ReadonlySet<string>,
  visibleItems: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (hiddenTypes.has(silence.itemType)) {
    return false;
  }

  if (!viewer.restriction && !viewer.groupFilter) {
    return true;
  }

  const items = visibleItems.get(silence.itemType);

  return silence.itemId === null ? items !== undefined : items?.has(silence.itemId) === true;
}

/**
 * Applies a viewer restriction to a group: when its items carry `param`, only items with an allowed value remain and
 * the total becomes their number (the group disappears when none remains). Groups without the param are unchanged.
 */
function restrictGroup(
  group: ActionCenterGroup,
  param: string,
  allowed: ReadonlySet<string>,
): ActionCenterGroup | null {
  const carriesParam = group.items.some((item) => item.params?.[param] !== undefined && item.params?.[param] !== null);

  if (!carriesParam) {
    return group;
  }

  const items = group.items.filter((item) => {
    const value = item.params?.[param];

    return value === undefined || value === null || allowed.has(String(value));
  });

  return items.length > 0 ? { ...group, items, total: items.length } : null;
}

/**
 * Builds what one viewer sees: groups outside their role are dropped, silenced groups / items are marked (and not
 * counted), items are capped at {@link ACTION_CENTER_VIEW_ITEM_LIMIT} with open items first.
 */
export function buildActionCenterView(
  snapshot: ActionCenterSnapshot,
  viewer: ActionCenterViewer,
  allSilences: readonly ActionCenterSilenceEntity[],
  now: Date,
): ActionCenterView {
  const silences = silencesForViewer(allSilences, viewer, now);
  const typeSilences = new Map<string, ActionCenterSilenceEntity>();
  const itemSilences = new Map<string, ActionCenterSilenceEntity>();

  for (const silence of silences) {
    if (silence.itemId === null) {
      typeSilences.set(silence.itemType, pickSilence(typeSilences.get(silence.itemType), silence));
    } else {
      const key = `${silence.itemType}\u0000${silence.itemId}`;

      itemSilences.set(key, pickSilence(itemSilences.get(key), silence));
    }
  }

  const counts = { open: 0, setup: 0, silenced: 0 };
  /** Types the viewer may not see (their silences are not listed either). */
  const hiddenTypes = new Set<string>();
  /** Items visible to a restricted viewer, per type (item silences of other records are not listed). */
  const visibleItems = new Map<string, Set<string>>();
  const groups: ActionCenterViewGroup[] = [];
  const restriction = viewer.restriction ?? null;
  const allowed = restriction ? new Set(restriction.values) : null;

  for (const sourceGroup of snapshot.groups) {
    if (sourceGroup.audience === 'admin' && viewer.role !== 'admin') {
      hiddenTypes.add(sourceGroup.type);
      continue;
    }

    if (viewer.groupFilter && !viewer.groupFilter(sourceGroup.type, sourceGroup.category)) {
      hiddenTypes.add(sourceGroup.type);
      continue;
    }

    const group = restriction && allowed ? restrictGroup(sourceGroup, restriction.param, allowed) : sourceGroup;

    if (!group) {
      continue;
    }

    visibleItems.set(group.type, new Set(group.items.map((item) => item.id)));

    const groupSilence = typeSilences.get(group.type) ?? null;
    const items: ActionCenterViewItem[] = group.items.map((item) => ({
      id: item.id,
      params: item.params ?? {},
      occurredAt: item.occurredAt ?? null,
      silencedBy: itemSilences.get(`${group.type}\u0000${item.id}`)?.id ?? null,
    }));
    const silencedItems = items.filter((item) => item.silencedBy !== null).length;
    const openCount = groupSilence ? 0 : Math.max(0, group.total - silencedItems);
    const silencedCount = group.total - openCount;
    // Open items first (newest first inside each block), silenced ones after them.
    const ordered = [...items].sort((a, b) => {
      if ((a.silencedBy === null) !== (b.silencedBy === null)) {
        return a.silencedBy === null ? -1 : 1;
      }

      return (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '');
    });

    counts.open += openCount;
    counts.silenced += silencedCount;

    if (group.kind === 'setup') {
      counts.setup += openCount;
    }

    groups.push({
      type: group.type,
      category: group.category,
      severity: group.severity,
      kind: group.kind,
      audience: group.audience,
      total: group.total,
      openCount,
      params: group.params,
      items: ordered.slice(0, ACTION_CENTER_VIEW_ITEM_LIMIT),
      silencedBy: groupSilence?.id ?? null,
    });
  }

  return {
    generatedAt: snapshot.generatedAt,
    role: viewer.role,
    canSilenceForEveryone: viewer.role === 'admin',
    counts,
    groups,
    silences: silences
      .filter((silence) => isSilenceVisible(silence, viewer, hiddenTypes, visibleItems))
      .map((silence) => toSilenceView(silence, viewer))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

/** Console role → action center role; `null` for everyone else (regular users, unknown roles). */
export function toActionCenterViewerRole(role: string | null | undefined): ActionCenterViewer['role'] | null {
  return role === 'admin' || role === 'manager' ? role : null;
}
