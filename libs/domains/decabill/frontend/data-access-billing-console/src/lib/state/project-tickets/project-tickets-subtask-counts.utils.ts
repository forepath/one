import { isTerminalTicketStatus } from './project-tickets.constants';
import type { ProjectTicketResponse, ProjectTicketSubtaskCountsDto } from '../../types/projects.types';

function directDescendantTickets(
  ticket: ProjectTicketResponse,
  list: readonly ProjectTicketResponse[],
): readonly ProjectTicketResponse[] {
  if (ticket.children && ticket.children.length > 0) {
    return ticket.children;
  }

  return list.filter((t) => (t.parentId ?? null) === ticket.id);
}

export function computeDirectSubtaskCounts(
  ticket: ProjectTicketResponse,
  list: readonly ProjectTicketResponse[],
): ProjectTicketSubtaskCountsDto {
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

export function withSubtaskCounts(
  ticket: ProjectTicketResponse,
  list: readonly ProjectTicketResponse[],
): ProjectTicketResponse {
  return { ...ticket, subtaskCounts: computeDirectSubtaskCounts(ticket, list) };
}

export function enrichTicketsWithSubtaskCounts(
  list: ProjectTicketResponse[],
  detail: ProjectTicketResponse | null,
): { list: ProjectTicketResponse[]; detail: ProjectTicketResponse | null } {
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
