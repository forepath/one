import { isTerminalTicketStatus } from './tickets.constants';
import type { TicketResponseDto, TicketSubtaskCountsDto } from './tickets.types';

function directDescendantTickets(
  ticket: TicketResponseDto,
  list: readonly TicketResponseDto[],
): readonly TicketResponseDto[] {
  if (ticket.children && ticket.children.length > 0) {
    return ticket.children;
  }

  return list.filter((t) => (t.parentId ?? null) === ticket.id);
}

export function computeDirectSubtaskCounts(
  ticket: TicketResponseDto,
  list: readonly TicketResponseDto[],
): TicketSubtaskCountsDto {
  let open = 0;
  let done = 0;

  for (const c of directDescendantTickets(ticket, list)) {
    if (isTerminalTicketStatus(c.status)) {
      done += 1;
    } else {
      open += 1;
    }
  }

  return { open, done };
}

export function withSubtaskCounts(ticket: TicketResponseDto, list: readonly TicketResponseDto[]): TicketResponseDto {
  return { ...ticket, subtaskCounts: computeDirectSubtaskCounts(ticket, list) };
}

/** Recomputes `subtaskCounts` on every list row and on `detail` (including `detail.children`). */
export function enrichTicketsWithSubtaskCounts(
  list: TicketResponseDto[],
  detail: TicketResponseDto | null,
): { list: TicketResponseDto[]; detail: TicketResponseDto | null } {
  const listWithCounts = list.map((t) => withSubtaskCounts(t, list));

  if (!detail) {
    return { list: listWithCounts, detail: null };
  }

  const detailWithCounts = withSubtaskCounts(detail, list);
  const children = detail.children?.map((c) => withSubtaskCounts(c, list));

  return {
    list: listWithCounts,
    detail: children ? { ...detailWithCounts, children } : detailWithCounts,
  };
}
