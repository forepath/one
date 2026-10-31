import type {
  TicketBoardRow,
  UpdateTicketDto,
  TicketPriority,
  TicketResponseDto,
  TicketStatus,
} from '@forepath/agenstra/frontend/data-access-agent-console';
import {
  fpcRunBulk,
  type FpcBadgeTone,
  type FpcBulkResult,
  type FpcTableColumn,
  type FpcTableSort,
  type FpcTableState,
} from '@forepath/shared/frontend/ui-components';

import { ticketLaneStatusLabel } from './ticket-lane-status-label';

/** Every ticket status in workflow order (board lanes first, then the terminal ones). */
export const TICKET_STATUSES: readonly TicketStatus[] = ['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed'];
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['critical', 'high', 'medium', 'low'];

/** Status filter of the tickets table: `open` = the former board lanes (draft … prototype), `all`, or one status. */
export type TicketStatusFilter = 'open' | 'all' | TicketStatus;

/** Rows shown per infinite-scroll step of the tickets table. */
export const TICKET_TABLE_CHUNK = 50;

const OPEN_STATUSES: ReadonlySet<TicketStatus> = new Set(['draft', 'todo', 'in_progress', 'prototype']);

export function ticketPriorityLabel(priority: TicketPriority): string {
  switch (priority) {
    case 'low':
      return $localize`:@@featureTicketsBoard-priorityLow:Low`;
    case 'medium':
      return $localize`:@@featureTicketsBoard-priorityMedium:Medium`;
    case 'high':
      return $localize`:@@featureTicketsBoard-priorityHigh:High`;
    case 'critical':
      return $localize`:@@featureTicketsBoard-priorityCritical:Critical`;
    default:
      return priority;
  }
}

export function ticketPriorityTone(priority: TicketPriority): FpcBadgeTone {
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

export function ticketStatusTone(status: TicketStatus): FpcBadgeTone {
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

const STATUS_ICON: Record<TicketStatus, string> = {
  draft: 'pencil',
  todo: 'circle',
  in_progress: 'play-circle-fill',
  prototype: 'lightning-charge-fill',
  done: 'check-circle-fill',
  closed: 'archive',
};

/** State cell of a ticket: readable status + tone + icon (sorted in workflow order). */
export function ticketStatusState(status: TicketStatus): FpcTableState {
  const index = TICKET_STATUSES.indexOf(status);

  return {
    label: ticketLaneStatusLabel(status),
    tone: ticketStatusTone(status),
    icon: STATUS_ICON[status] ?? 'circle',
    severity: index < 0 ? TICKET_STATUSES.length : index,
  };
}

export function ticketStatusFilterLabel(value: TicketStatusFilter): string {
  if (value === 'open') return $localize`:@@featureTicketsBoard-filterStatusOpen:Open (draft to prototype)`;
  if (value === 'all') return $localize`:@@featureTicketsBoard-filterStatusAll:All statuses`;

  return ticketLaneStatusLabel(value);
}

export function ticketSubtaskText(ticket: TicketResponseDto): string {
  const counts = ticket.subtaskCounts;
  const total = counts ? counts.open + counts.done : 0;

  return total > 0 && counts ? `${counts.done}/${total}` : '';
}

/** Columns of the tickets table (State · Ticket · Priority · Subtasks · Created by · Updated). */
export function ticketTableColumns(): FpcTableColumn<TicketBoardRow>[] {
  return [
    {
      id: 'status',
      label: $localize`:@@featureTicketsBoard-colStatus:Status`,
      type: 'state',
      state: (row) => ticketStatusState(row.ticket.status),
    },
    {
      id: 'ticket',
      label: $localize`:@@featureTicketsBoard-colTicket:Ticket`,
      value: (row) => `${row.ticket.shas.short ?? ''} ${row.ticket.title}`.trim(),
      required: true,
      priority: 1,
    },
    {
      id: 'priority',
      label: $localize`:@@featureTicketsBoard-colPriority:Priority`,
      value: (row) => TICKET_PRIORITIES.indexOf(row.ticket.priority),
      width: '7rem',
      priority: 1,
    },
    {
      id: 'subtasks',
      label: $localize`:@@featureTicketsBoard-colSubtasks:Subtasks`,
      value: (row) => ticketSubtaskText(row.ticket),
      align: 'end',
      width: '6rem',
      priority: 3,
    },
    {
      id: 'createdBy',
      label: $localize`:@@featureTicketsBoard-colCreatedBy:Created by`,
      value: (row) => row.ticket.createdByEmail ?? '',
      priority: 3,
    },
    {
      id: 'updated',
      label: $localize`:@@featureTicketsBoard-colUpdated:Updated`,
      value: (row) => row.ticket.updatedAt,
      width: '10rem',
      priority: 2,
    },
  ];
}

function byUpdatedDesc(a: TicketResponseDto, b: TicketResponseDto): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function searchText(ticket: TicketResponseDto): string {
  return [
    ticket.shas.short,
    ticket.title,
    ticket.content ?? '',
    ticketLaneStatusLabel(ticket.status),
    ticketPriorityLabel(ticket.priority),
    ticket.createdByEmail ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Lanes view: the table's search and priority filter narrow the lane rows too (row by row, like the table); the
 * status filter does not apply (the lanes are the status columns).
 */
export function filterTicketLaneRows(
  rows: readonly TicketBoardRow[],
  query: Pick<TicketTableQuery, 'priority' | 'search'>,
): TicketBoardRow[] {
  const needle = query.search.trim().toLowerCase();

  if (!needle && !query.priority) return [...rows];

  return rows.filter(
    (row) =>
      (!query.priority || row.ticket.priority === query.priority) &&
      (!needle || searchText(row.ticket).includes(needle)),
  );
}

export interface TicketTableQuery {
  status: TicketStatusFilter;
  priority: TicketPriority | '';
  search: string;
  sort: FpcTableSort | null;
}

/**
 * Rows of the tickets table (former swimlanes): root tickets matching the status filter in workflow order, newest
 * first, each followed by its direct subtasks (depth 1; deeper ones stay in the detail). Priority and search narrow
 * single rows. A column sort flattens the tree (depth 0) and orders all rows by that column.
 */
export function buildTicketTableRows(
  list: readonly TicketResponseDto[],
  query: TicketTableQuery,
  columns: readonly FpcTableColumn<TicketBoardRow>[] = ticketTableColumns(),
): TicketBoardRow[] {
  const ids = new Set(list.map((ticket) => ticket.id));
  const children = new Map<string, TicketResponseDto[]>();
  const roots: TicketResponseDto[] = [];

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

  const statusMatches = (status: TicketStatus) =>
    query.status === 'all' || (query.status === 'open' ? OPEN_STATUSES.has(status) : status === query.status);
  const orderedRoots = roots
    .filter((ticket) => statusMatches(ticket.status))
    .sort((a, b) => TICKET_STATUSES.indexOf(a.status) - TICKET_STATUSES.indexOf(b.status) || byUpdatedDesc(a, b));
  const needle = query.search.trim().toLowerCase();
  const keep = (ticket: TicketResponseDto) =>
    (!query.priority || ticket.priority === query.priority) && (!needle || searchText(ticket).includes(needle));
  const rows: TicketBoardRow[] = [];

  for (const root of orderedRoots) {
    if (keep(root)) rows.push({ ticket: root, depth: 0 });

    for (const child of [...(children.get(root.id) ?? [])].sort(byUpdatedDesc)) {
      if (keep(child)) rows.push({ ticket: child, depth: 1 });
    }
  }

  const sort = query.sort;
  const column = sort ? columns.find((candidate) => candidate.id === sort.column) : undefined;

  if (!sort || !column) return rows;

  const valueOf = (row: TicketBoardRow): string | number => {
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
 * "and n more" hint: tickets the search / priority filter matches that the current view does not show (other
 * statuses, closed tickets, statuses without a lane). Counted against every row the table could show with all
 * statuses (roots + direct subtasks), so a click on the hint can reveal all of them. 0 without search / priority.
 */
export function ticketHiddenMatchCount(
  list: readonly TicketResponseDto[],
  query: Pick<TicketTableQuery, 'priority' | 'search'>,
  visibleIds: ReadonlySet<string>,
): number {
  if (!query.search.trim() && !query.priority) return 0;

  return buildTicketTableRows(list, {
    status: 'all',
    priority: query.priority,
    search: query.search,
    sort: null,
  }).filter((row) => !visibleIds.has(row.ticket.id)).length;
}

export function ticketHiddenMatchLabel(count: number): string {
  return count === 1
    ? $localize`:@@featureTicketsBoard-moreMatchesOne:and 1 more`
    : $localize`:@@featureTicketsBoard-moreMatchesMany:and ${count}:count: more`;
}

/**
 * Bulk status / priority change (3.38 D8): one `update` call per ticket (the single-ticket endpoint, so the server
 * checks each one); tickets that already have the value are skipped; every saved ticket goes to `applied` (store).
 */
export function bulkUpdateTickets(
  tickets: readonly TicketResponseDto[],
  dto: Pick<UpdateTicketDto, 'status' | 'priority'>,
  update: (id: string, dto: UpdateTicketDto) => Promise<TicketResponseDto>,
  applied: (ticket: TicketResponseDto) => void,
): Promise<FpcBulkResult<TicketResponseDto>> {
  const pending = tickets.filter(
    (ticket) =>
      (dto.status !== undefined && ticket.status !== dto.status) ||
      (dto.priority !== undefined && ticket.priority !== dto.priority),
  );

  return fpcRunBulk(pending, async (ticket) => applied(await update(ticket.id, dto)));
}

/**
 * Bulk delete: one `remove` call per ticket, subtasks first and one at a time (a parent's delete takes its subtasks
 * along); every deleted ticket goes to `removed` (store).
 */
export function bulkDeleteTickets(
  tickets: readonly TicketResponseDto[],
  remove: (id: string) => Promise<unknown>,
  removed: (ticket: TicketResponseDto) => void,
): Promise<FpcBulkResult<TicketResponseDto>> {
  const ordered = [...tickets].sort((a, b) => Number(!a.parentId) - Number(!b.parentId));

  return fpcRunBulk(
    ordered,
    async (ticket) => {
      await remove(ticket.id);
      removed(ticket);
    },
    1,
  );
}
