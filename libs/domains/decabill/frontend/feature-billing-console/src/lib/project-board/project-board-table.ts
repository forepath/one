import type {
  ProjectTicketBoardRow,
  ProjectTicketPriority,
  ProjectTicketResponse,
  ProjectTicketStatus,
  UpdateProjectTicketDto,
} from '@forepath/decabill/frontend/data-access-billing-console';
import {
  fpcRunBulk,
  type FpcBadgeTone,
  type FpcBulkResult,
  type FpcTableColumn,
  type FpcTableSort,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';

import { projectTicketLaneStatusLabel } from '../project-ticket-lane-status-label';

/** Every ticket status in workflow order (board lanes first, then `closed`). */
export const PROJECT_TICKET_STATUSES: readonly ProjectTicketStatus[] = [
  'draft',
  'todo',
  'in_progress',
  'prototype',
  'done',
  'closed',
];
export const PROJECT_TICKET_PRIORITIES: readonly ProjectTicketPriority[] = ['critical', 'high', 'medium', 'low'];

/** Status filter of the board table: `board` = the lane statuses (draft … done), `all`, or one status. */
export type ProjectTicketStatusFilter = 'board' | 'all' | ProjectTicketStatus;

const BOARD_STATUSES: ReadonlySet<ProjectTicketStatus> = new Set(['draft', 'todo', 'in_progress', 'prototype', 'done']);

export function projectTicketPriorityLabel(priority: ProjectTicketPriority): string {
  switch (priority) {
    case 'low':
      return $localize`:@@featureProjectBoard-priorityLow:Low`;
    case 'medium':
      return $localize`:@@featureProjectBoard-priorityMedium:Medium`;
    case 'high':
      return $localize`:@@featureProjectBoard-priorityHigh:High`;
    case 'critical':
      return $localize`:@@featureProjectBoard-priorityCritical:Critical`;
    default:
      return priority;
  }
}

export function projectTicketPriorityTone(priority: ProjectTicketPriority): FpcBadgeTone {
  switch (priority) {
    case 'medium':
      return 'info';
    case 'high':
      return 'warning';
    case 'critical':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function projectTicketStatusTone(status: ProjectTicketStatus): FpcBadgeTone {
  switch (status) {
    case 'todo':
      return 'primary';
    case 'in_progress':
      return 'info';
    case 'prototype':
      return 'warning';
    case 'done':
      return 'success';
    default:
      return 'neutral';
  }
}

const STATUS_ICON: Record<ProjectTicketStatus, string> = {
  draft: 'pencil',
  todo: 'circle',
  in_progress: 'play-circle-fill',
  prototype: 'lightning-charge-fill',
  done: 'check-circle-fill',
  closed: 'archive',
};

/** State cell of a ticket: readable lane status + tone + icon (sorted in workflow order). */
export function projectTicketStatusState(status: ProjectTicketStatus): FpcTableState {
  const index = PROJECT_TICKET_STATUSES.indexOf(status);

  return {
    label: projectTicketLaneStatusLabel(status),
    tone: projectTicketStatusTone(status),
    icon: STATUS_ICON[status] ?? 'circle',
    severity: index < 0 ? PROJECT_TICKET_STATUSES.length : index,
  };
}

export function projectTicketStatusFilterLabel(value: ProjectTicketStatusFilter): string {
  if (value === 'board') return $localize`:@@featureProjectBoard-filterStatusBoard:On the board (without closed)`;
  if (value === 'all') return $localize`:@@featureProjectBoard-filterStatusAll:All statuses`;

  return projectTicketLaneStatusLabel(value);
}

export function projectTicketSubtaskText(ticket: ProjectTicketResponse): string {
  const counts = ticket.subtaskCounts;
  const total = counts ? counts.open + counts.done : 0;

  return total > 0 && counts ? `${counts.done}/${total}` : '';
}

/** Columns of the board table (State · Ticket · Priority · Milestone · Subtasks · Created by · Updated). */
export function projectTicketTableColumns(
  milestoneLabel: (milestoneId: string | null | undefined) => string,
): FpcTableColumn<ProjectTicketBoardRow>[] {
  return [
    {
      id: 'status',
      label: $localize`:@@featureProjectBoard-colStatus:Status`,
      type: 'state',
      state: (row) => projectTicketStatusState(row.ticket.status),
    },
    {
      id: 'ticket',
      label: $localize`:@@featureProjectBoard-colTicket:Ticket`,
      value: (row) => `${row.ticket.shas.short ?? ''} ${row.ticket.title}`.trim(),
      required: true,
      priority: 1,
    },
    {
      id: 'priority',
      label: $localize`:@@featureProjectBoard-colPriority:Priority`,
      value: (row) => PROJECT_TICKET_PRIORITIES.indexOf(row.ticket.priority),
      width: '7rem',
      priority: 1,
    },
    {
      id: 'milestone',
      label: $localize`:@@featureProjectBoard-colMilestone:Milestone`,
      value: (row) => (row.ticket.milestoneId ? milestoneLabel(row.ticket.milestoneId) : ''),
      priority: 2,
    },
    {
      id: 'subtasks',
      label: $localize`:@@featureProjectBoard-colSubtasks:Subtasks`,
      value: (row) => projectTicketSubtaskText(row.ticket),
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    {
      id: 'createdBy',
      label: $localize`:@@featureProjectBoard-colCreatedBy:Created by`,
      value: (row) => row.ticket.createdByEmail ?? '',
      priority: 3,
    },
    {
      id: 'updated',
      label: $localize`:@@featureProjectBoard-colUpdated:Updated`,
      value: (row) => row.ticket.updatedAt,
      width: '10rem',
      priority: 2,
    },
  ];
}

function byUpdatedDesc(a: ProjectTicketResponse, b: ProjectTicketResponse): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function searchText(ticket: ProjectTicketResponse): string {
  return [
    ticket.shas.short,
    ticket.title,
    ticket.content ?? '',
    projectTicketLaneStatusLabel(ticket.status),
    projectTicketPriorityLabel(ticket.priority),
    ticket.createdByEmail ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export interface ProjectTicketTableQuery {
  status: ProjectTicketStatusFilter;
  priority: ProjectTicketPriority | '';
  search: string;
  sort: FpcTableSort | null;
}

/**
 * Lanes view: the board search and priority filter narrow the lane rows (row by row, like the table); the status
 * filter does not apply (the lanes are the status columns).
 */
export function filterProjectTicketLaneRows(
  rows: readonly ProjectTicketBoardRow[],
  query: Pick<ProjectTicketTableQuery, 'priority' | 'search'>,
): ProjectTicketBoardRow[] {
  const needle = query.search.trim().toLowerCase();

  if (!needle && !query.priority) return [...rows];

  return rows.filter(
    (row) =>
      (!query.priority || row.ticket.priority === query.priority) &&
      (!needle || searchText(row.ticket).includes(needle)),
  );
}

/**
 * Rows of the board table: root tickets matching the status filter in workflow order, newest first, each followed by
 * its direct subtasks (depth 1, like the lanes). Priority and search narrow single rows. A column sort flattens the
 * tree (depth 0) and orders all rows by that column.
 */
export function buildProjectTicketTableRows(
  list: readonly ProjectTicketResponse[],
  query: ProjectTicketTableQuery,
  columns: readonly FpcTableColumn<ProjectTicketBoardRow>[],
): ProjectTicketBoardRow[] {
  const ids = new Set(list.map((ticket) => ticket.id));
  const children = new Map<string, ProjectTicketResponse[]>();
  const roots: ProjectTicketResponse[] = [];

  for (const ticket of list) {
    const parent = ticket.parentId ?? null;

    if (parent && ids.has(parent)) {
      const siblings = children.get(parent) ?? [];

      siblings.push(ticket);
      children.set(parent, siblings);
    } else if (!parent) {
      roots.push(ticket);
    }
  }

  const statusMatches = (status: ProjectTicketStatus) =>
    query.status === 'all' || (query.status === 'board' ? BOARD_STATUSES.has(status) : status === query.status);
  const orderedRoots = roots
    .filter((ticket) => statusMatches(ticket.status))
    .sort(
      (a, b) =>
        PROJECT_TICKET_STATUSES.indexOf(a.status) - PROJECT_TICKET_STATUSES.indexOf(b.status) || byUpdatedDesc(a, b),
    );
  const needle = query.search.trim().toLowerCase();
  const keep = (ticket: ProjectTicketResponse) =>
    (!query.priority || ticket.priority === query.priority) && (!needle || searchText(ticket).includes(needle));
  const rows: ProjectTicketBoardRow[] = [];

  for (const root of orderedRoots) {
    if (keep(root)) rows.push({ ticket: root, depth: 0 });

    for (const child of [...(children.get(root.id) ?? [])].sort(byUpdatedDesc)) {
      if (keep(child)) rows.push({ ticket: child, depth: 1 });
    }
  }

  const sort = query.sort;
  const column = sort ? columns.find((candidate) => candidate.id === sort.column) : undefined;

  if (!sort || !column) return rows;

  const valueOf = (row: ProjectTicketBoardRow): string | number => {
    if (column.type === 'state' && column.state) return column.state(row)?.severity ?? 99;

    const value = column.value?.(row);

    return typeof value === 'number' ? value : String(value ?? '');
  };
  const factor = sort.direction === 'asc' ? 1 : -1;

  return rows
    .map((row, index) => ({ row: { ticket: row.ticket, depth: 0 }, index, key: valueOf(row) }))
    .sort((a, b) => {
      const order =
        typeof a.key === 'number' && typeof b.key === 'number'
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key), undefined, { numeric: true, sensitivity: 'base' });

      return order * factor || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * "and n more" hint: tickets the search / priority filter matches that the current view does not show (closed
 * tickets, other statuses). Counted against every row the table could show with all statuses (roots + direct
 * subtasks), so a click on the hint can reveal all of them. 0 without search / priority.
 */
export function projectTicketHiddenMatchCount(
  list: readonly ProjectTicketResponse[],
  query: Pick<ProjectTicketTableQuery, 'priority' | 'search'>,
  visibleIds: ReadonlySet<string>,
  columns: readonly FpcTableColumn<ProjectTicketBoardRow>[],
): number {
  if (!query.search.trim() && !query.priority) return 0;

  return buildProjectTicketTableRows(
    list,
    { status: 'all', priority: query.priority, search: query.search, sort: null },
    columns,
  ).filter((row) => !visibleIds.has(row.ticket.id)).length;
}

export function projectTicketHiddenMatchLabel(count: number): string {
  return count === 1
    ? $localize`:@@featureProjectBoard-moreMatchesOne:and 1 more`
    : $localize`:@@featureProjectBoard-moreMatchesMany:and ${count}:count: more`;
}

/** Bulk actions only touch tickets an admin may still change (locked tickets are read-only, as on the cards). */
export function projectTicketEditable(ticket: ProjectTicketResponse, isAdmin: boolean): boolean {
  return isAdmin && !ticket.locked;
}

/**
 * Bulk status / priority change: one `update` call per ticket (the single-ticket endpoint, so the server checks each
 * one); tickets that already have the value are skipped.
 */
export function bulkUpdateProjectTickets(
  tickets: readonly ProjectTicketResponse[],
  dto: Pick<UpdateProjectTicketDto, 'status' | 'priority'>,
  update: (id: string, dto: UpdateProjectTicketDto) => Promise<unknown>,
): Promise<FpcBulkResult<ProjectTicketResponse>> {
  const pending = tickets.filter(
    (ticket) =>
      (dto.status !== undefined && ticket.status !== dto.status) ||
      (dto.priority !== undefined && ticket.priority !== dto.priority),
  );

  return fpcRunBulk(pending, async (ticket) => {
    await update(ticket.id, dto);
  });
}

/** Bulk delete: one `delete` call per ticket, subtasks first and one at a time (a parent takes its subtasks along). */
export function bulkDeleteProjectTickets(
  tickets: readonly ProjectTicketResponse[],
  remove: (id: string) => Promise<unknown>,
): Promise<FpcBulkResult<ProjectTicketResponse>> {
  const ordered = [...tickets].sort((a, b) => Number(!a.parentId) - Number(!b.parentId));

  return fpcRunBulk(
    ordered,
    async (ticket) => {
      await remove(ticket.id);
    },
    1,
  );
}
