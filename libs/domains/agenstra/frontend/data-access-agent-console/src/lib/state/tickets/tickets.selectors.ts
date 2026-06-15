import { createFeatureSelector, createSelector } from '@ngrx/store';

import {
  BOARD_LANE_STATUSES,
  isBoardLaneStatus,
  isTerminalTicketStatus,
  type BoardLaneStatus,
} from './tickets.constants';
import type { TicketsState } from './tickets.reducer';
import type { TicketResponseDto } from './tickets.types';

export const selectTicketsState = createFeatureSelector<TicketsState>('tickets');

/** Flat row for the swimlane board: ticket + indent depth (nested under parent in parent's lane). */
export interface TicketBoardRow {
  ticket: TicketResponseDto;
  depth: number;
}

export const selectTicketsList = createSelector(selectTicketsState, (s) => s.list);

export const selectTicketsLoadingList = createSelector(selectTicketsState, (s) => s.loadingList);

export const selectTicketsSelectedId = createSelector(selectTicketsState, (s) => s.selectedTicketId);

export const selectTicketsDetail = createSelector(selectTicketsState, (s) => s.detail);

export const selectTicketsComments = createSelector(selectTicketsState, (s) => s.comments);

export const selectTicketsActivity = createSelector(selectTicketsState, (s) => s.activity);

export const selectTicketsLoadingDetail = createSelector(selectTicketsState, (s) => s.loadingDetail);

export const selectTicketsSaving = createSelector(selectTicketsState, (s) => s.saving);

export const selectTicketsError = createSelector(selectTicketsState, (s) => s.error);

/** Root tickets only (no parent), grouped by swimlane status. Excludes terminal done/closed roots. */
export const selectRootTicketsByStatus = createSelector(selectTicketsList, (list) => {
  const roots = list.filter((t) => !t.parentId);
  const byStatus: Record<BoardLaneStatus, typeof list> = {
    draft: [],
    todo: [],
    in_progress: [],
    prototype: [],
  };

  for (const t of roots) {
    if (isTerminalTicketStatus(t.status)) {
      continue;
    }

    if (isBoardLaneStatus(t.status)) {
      byStatus[t.status].push(t);
    }
  }

  return byStatus;
});

function buildChildrenByParent(list: TicketResponseDto[]): Map<string | null, TicketResponseDto[]> {
  const byParent = new Map<string | null, TicketResponseDto[]>();

  for (const t of list) {
    const p = t.parentId ?? null;

    if (!byParent.has(p)) {
      byParent.set(p, []);
    }

    const siblings = byParent.get(p);

    if (siblings) {
      siblings.push(t);
    }
  }

  for (const arr of byParent.values()) {
    arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return byParent;
}

/**
 * Swimlane rows: roots in the lane matching their status; only **direct** subtasks (one level) are nested
 * under each root in that lane. Deeper descendants stay in the detail view only.
 */
export const selectTicketsBoardRowsByStatus = createSelector(selectTicketsList, (list) => {
  const byParent = buildChildrenByParent(list);
  const byStatus: Record<BoardLaneStatus, TicketBoardRow[]> = {
    draft: [],
    todo: [],
    in_progress: [],
    prototype: [],
  };

  for (const lane of BOARD_LANE_STATUSES) {
    const roots = (byParent.get(null) ?? []).filter((t) => t.status === lane);
    const out = byStatus[lane];

    for (const r of roots) {
      out.push({ ticket: r, depth: 0 });

      for (const child of byParent.get(r.id) ?? []) {
        out.push({ ticket: child, depth: 1 });
      }
    }
  }

  return byStatus;
});

/** Ancestor chain from root → current detail (inclusive), using the flat list. */
export const selectDetailBreadcrumb = createSelector(selectTicketsList, selectTicketsDetail, (list, detail) => {
  if (!detail) {
    return [] as TicketResponseDto[];
  }

  const byId = new Map(list.map((t) => [t.id, t]));
  const chain: TicketResponseDto[] = [];
  let cur: TicketResponseDto | undefined = detail;
  const visited = new Set<string>();

  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.unshift(cur);
    const parentId: string | null | undefined = cur.parentId;

    cur = parentId != null && parentId !== '' ? byId.get(parentId) : undefined;
  }

  return chain;
});

export const selectTicketById = (id: string) =>
  createSelector(selectTicketsList, (list) => list.find((t) => t.id === id) ?? null);
