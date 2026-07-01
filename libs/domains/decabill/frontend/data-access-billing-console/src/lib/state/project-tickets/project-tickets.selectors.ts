import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { ProjectTicketResponse } from '../../types/projects.types';

import { BOARD_LANE_STATUSES, isBoardLaneStatus, type BoardLaneStatus } from './project-tickets.constants';
import type { ProjectTicketsState } from './project-tickets.reducer';

export const selectProjectTicketsState = createFeatureSelector<ProjectTicketsState>('projectTickets');

export interface ProjectTicketBoardRow {
  ticket: ProjectTicketResponse;
  depth: number;
}

export const selectProjectTicketsProjectId = createSelector(selectProjectTicketsState, (s) => s.projectId);
export const selectProjectTicketsList = createSelector(selectProjectTicketsState, (s) => s.list);
export const selectProjectTicketsLoadingList = createSelector(selectProjectTicketsState, (s) => s.loadingList);
export const selectProjectTicketsSelectedId = createSelector(selectProjectTicketsState, (s) => s.selectedTicketId);
export const selectProjectTicketsDetail = createSelector(selectProjectTicketsState, (s) => s.detail);
export const selectProjectTicketsComments = createSelector(selectProjectTicketsState, (s) => s.comments);
export const selectProjectTicketsActivity = createSelector(selectProjectTicketsState, (s) => s.activity);
export const selectProjectTicketsLoadingDetail = createSelector(selectProjectTicketsState, (s) => s.loadingDetail);
export const selectProjectTicketsSaving = createSelector(selectProjectTicketsState, (s) => s.saving);
export const selectProjectTicketsError = createSelector(selectProjectTicketsState, (s) => s.error);

function buildChildrenByParent(list: ProjectTicketResponse[]): Map<string | null, ProjectTicketResponse[]> {
  const byParent = new Map<string | null, ProjectTicketResponse[]>();

  for (const t of list) {
    const p = t.parentId ?? null;

    if (!byParent.has(p)) byParent.set(p, []);

    byParent.get(p)?.push(t);
  }

  for (const arr of byParent.values()) {
    arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  return byParent;
}

export const selectProjectTicketsBoardRowsByStatus = createSelector(selectProjectTicketsList, (list) => {
  const byParent = buildChildrenByParent(list);
  const byStatus: Record<BoardLaneStatus, ProjectTicketBoardRow[]> = {
    draft: [],
    todo: [],
    in_progress: [],
    prototype: [],
    done: [],
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

export const selectProjectTicketDetailBreadcrumb = createSelector(
  selectProjectTicketsList,
  selectProjectTicketsDetail,
  (list, detail) => {
    if (!detail) return [] as ProjectTicketResponse[];

    const byId = new Map(list.map((t) => [t.id, t]));
    const chain: ProjectTicketResponse[] = [];
    let cur: ProjectTicketResponse | undefined = detail;
    const visited = new Set<string>();

    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.unshift(cur);
      const pid: string | null | undefined = cur.parentId;

      cur = pid != null && pid !== '' ? byId.get(pid) : undefined;
    }

    return chain;
  },
);

export const selectRootProjectTicketsByStatus = createSelector(selectProjectTicketsList, (list) => {
  const roots = list.filter((t) => !t.parentId);
  const byStatus: Record<BoardLaneStatus, ProjectTicketResponse[]> = {
    draft: [],
    todo: [],
    in_progress: [],
    prototype: [],
    done: [],
  };

  for (const t of roots) {
    if (t.status === 'closed') continue;

    if (isBoardLaneStatus(t.status)) byStatus[t.status].push(t);
  }

  return byStatus;
});
