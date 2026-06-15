import { createReducer, on } from '@ngrx/store';

import {
  approveTicketAutomationSuccess,
  loadTicketAutomationSuccess,
  patchTicketAutomationSuccess,
  ticketBoardAutomationUpsert,
  unapproveTicketAutomationSuccess,
} from '../ticket-automation/ticket-automation.actions';

import { enrichTicketsWithSubtaskCounts } from './tickets-subtask-counts.utils';
import {
  addTicketComment,
  addTicketCommentFailure,
  addTicketCommentSuccess,
  closeTicketDetail,
  clearTicketsError,
  createTicket,
  createTicketFailure,
  createTicketSuccess,
  deleteTicket,
  deleteTicketFailure,
  deleteTicketSuccess,
  loadTicketDetailBundleSuccess,
  loadTicketDetailFailure,
  loadTickets,
  loadTicketsFailure,
  loadTicketsSuccess,
  migrateTicket,
  migrateTicketFailure,
  migrateTicketSuccess,
  openTicketDetail,
  prependTicketDetailActivity,
  replaceTicketDetailActivity,
  ticketBoardActivityCreated,
  ticketBoardCommentCreated,
  ticketBoardTicketRemoved,
  ticketBoardTicketUpsert,
  updateTicket,
  updateTicketFailure,
  updateTicketSuccess,
} from './tickets.actions';
import type { TicketActivityResponseDto, TicketCommentResponseDto, TicketResponseDto } from './tickets.types';

export interface TicketsState {
  list: TicketResponseDto[];
  selectedTicketId: string | null;
  detail: TicketResponseDto | null;
  comments: TicketCommentResponseDto[];
  activity: TicketActivityResponseDto[];
  loadingList: boolean;
  loadingDetail: boolean;
  saving: boolean;
  error: string | null;
}

export const initialTicketsState: TicketsState = {
  list: [],
  selectedTicketId: null,
  detail: null,
  comments: [],
  activity: [],
  loadingList: false,
  loadingDetail: false,
  saving: false,
  error: null,
};

function mergeTicketInList(list: TicketResponseDto[], ticket: TicketResponseDto): TicketResponseDto[] {
  const idx = list.findIndex((t) => t.id === ticket.id);

  if (idx < 0) {
    return [...list, ticket];
  }

  const next = [...list];

  next[idx] = ticket;

  return next;
}

/** When a subtask is created while its parent is open in the detail panel, merge it into `detail.children`. */
/** Keep `TicketResponseDto.automationEligible` in sync when automation config is loaded or patched (activity is refreshed separately). */
function syncTicketAutomationEligible(state: TicketsState, ticketId: string, eligible: boolean): TicketsState {
  const list = state.list.map((t) => (t.id === ticketId ? { ...t, automationEligible: eligible } : t));
  const detail = state.detail;

  if (!detail) {
    return { ...state, list };
  }

  if (detail.id === ticketId) {
    return { ...state, list, detail: { ...detail, automationEligible: eligible } };
  }

  const children = detail.children;

  if (children?.length) {
    const idx = children.findIndex((c) => c.id === ticketId);

    if (idx >= 0) {
      const nextChildren = [...children];

      nextChildren[idx] = { ...nextChildren[idx], automationEligible: eligible };

      return { ...state, list, detail: { ...detail, children: nextChildren } };
    }
  }

  return { ...state, list, detail };
}

function mergeCreatedChildIntoDetail(
  detail: TicketResponseDto | null,
  created: TicketResponseDto,
): TicketResponseDto | null {
  if (!detail) {
    return null;
  }

  const parentId = created.parentId ?? null;

  if (!parentId || parentId !== detail.id) {
    return detail;
  }

  const prevChildren = detail.children ?? [];
  const withoutDup = prevChildren.filter((c) => c.id !== created.id);

  return {
    ...detail,
    children: [...withoutDup, created],
  };
}

function flattenTicketSubtreeForList(root: TicketResponseDto): TicketResponseDto[] {
  const acc: TicketResponseDto[] = [];
  const visit = (t: TicketResponseDto): void => {
    const { children, ...rest } = t;

    acc.push({ ...rest, children: undefined });

    for (const c of children ?? []) {
      visit(c);
    }
  };

  visit(root);

  return acc;
}

function findTicketInTree(root: TicketResponseDto, id: string): TicketResponseDto | null {
  if (root.id === id) {
    return root;
  }

  for (const c of root.children ?? []) {
    const found = findTicketInTree(c, id);

    if (found) {
      return found;
    }
  }

  return null;
}

export const ticketsReducer = createReducer(
  initialTicketsState,
  on(loadTickets, (state) => ({ ...state, loadingList: true, error: null })),
  on(loadTicketsSuccess, (state, { tickets }) => {
    const { list, detail } = enrichTicketsWithSubtaskCounts(tickets, state.detail);

    return { ...state, loadingList: false, list, detail };
  }),
  on(loadTicketsFailure, (state, { error }) => ({ ...state, loadingList: false, error })),
  on(openTicketDetail, (state, { id }) => ({
    ...state,
    selectedTicketId: id,
    loadingDetail: true,
    detail: null,
    comments: [],
    activity: [],
    error: null,
  })),
  on(loadTicketDetailBundleSuccess, (state, { ticket, comments, activity }) => {
    const { list, detail } = enrichTicketsWithSubtaskCounts(state.list, ticket);

    return {
      ...state,
      list,
      detail,
      comments,
      activity,
      loadingDetail: false,
    };
  }),
  on(loadTicketDetailFailure, (state, { error }) => ({
    ...state,
    loadingDetail: false,
    error,
    selectedTicketId: null,
  })),
  on(closeTicketDetail, (state) => ({
    ...state,
    selectedTicketId: null,
    detail: null,
    comments: [],
    activity: [],
  })),
  on(createTicket, (state) => ({ ...state, saving: true, error: null })),
  on(createTicketSuccess, (state, { ticket, createdChildTickets = [] }) => {
    let list = mergeTicketInList(state.list, ticket);
    let detail = mergeCreatedChildIntoDetail(state.detail, ticket);

    for (const c of createdChildTickets) {
      list = mergeTicketInList(list, c);
      detail = mergeCreatedChildIntoDetail(detail, c);
    }

    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return { ...state, saving: false, list: enriched.list, detail: enriched.detail };
  }),
  on(createTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(updateTicket, (state) => ({ ...state, saving: true, error: null })),
  on(updateTicketSuccess, (state, { ticket, activity }) => {
    const list = mergeTicketInList(state.list, ticket);
    const detail =
      state.detail?.id === ticket.id
        ? {
            ...state.detail,
            ...ticket,
            children: ticket.children ?? state.detail.children,
          }
        : state.detail;
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return {
      ...state,
      saving: false,
      list: enriched.list,
      detail: enriched.detail,
      activity: state.selectedTicketId === ticket.id ? activity : state.activity,
    };
  }),
  on(updateTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(migrateTicket, (state) => ({ ...state, saving: true, error: null })),
  on(migrateTicketSuccess, (state, { rootTicket, migratedTicketIds, requestedTicketId }) => {
    let list = state.list.filter((t) => !migratedTicketIds.includes(t.id));

    for (const row of flattenTicketSubtreeForList(rootTicket)) {
      list = mergeTicketInList(list, row);
    }

    const focusFromRequest = migratedTicketIds.includes(requestedTicketId) ? requestedTicketId : null;
    const focusId = focusFromRequest ?? state.selectedTicketId ?? state.detail?.id ?? null;
    let detail = state.detail;

    if (focusId && migratedTicketIds.includes(focusId)) {
      const fromTree = findTicketInTree(rootTicket, focusId);
      const fromList = list.find((t) => t.id === focusId) ?? null;

      detail = fromTree ?? fromList ?? state.detail;
    }

    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return {
      ...state,
      saving: false,
      list: enriched.list,
      detail: enriched.detail,
      error: null,
    };
  }),
  on(migrateTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(deleteTicket, (state) => ({ ...state, saving: true, error: null })),
  on(deleteTicketSuccess, (state, { id }) => {
    const list = state.list.filter((t) => t.id !== id);
    const selectedTicketId = state.selectedTicketId === id ? null : state.selectedTicketId;
    const detail = state.detail?.id === id ? null : state.detail;
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return {
      ...state,
      saving: false,
      list: enriched.list,
      detail: enriched.detail,
      selectedTicketId,
    };
  }),
  on(deleteTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(addTicketComment, (state) => ({ ...state, saving: true, error: null })),
  on(addTicketCommentSuccess, (state, { comment, activity }) => {
    const idx = state.comments.findIndex((c) => c.id === comment.id);
    const comments = idx >= 0 ? state.comments.map((c, i) => (i === idx ? comment : c)) : [...state.comments, comment];

    return {
      ...state,
      saving: false,
      comments,
      activity: state.selectedTicketId === comment.ticketId ? activity : state.activity,
    };
  }),
  on(addTicketCommentFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(clearTicketsError, (state) => ({ ...state, error: null })),
  on(prependTicketDetailActivity, (state, { activity }) => {
    if (state.selectedTicketId !== activity.ticketId) {
      return state;
    }

    if (state.activity.some((a) => a.id === activity.id)) {
      return state;
    }

    return { ...state, activity: [activity, ...state.activity] };
  }),
  on(replaceTicketDetailActivity, (state, { ticketId, activity }) =>
    state.selectedTicketId === ticketId ? { ...state, activity } : state,
  ),
  on(
    patchTicketAutomationSuccess,
    approveTicketAutomationSuccess,
    unapproveTicketAutomationSuccess,
    loadTicketAutomationSuccess,
    ticketBoardAutomationUpsert,
    (state, { config }) => syncTicketAutomationEligible(state, config.ticketId, config.eligible),
  ),
  on(ticketBoardTicketUpsert, (state, { ticket }) => {
    const list = mergeTicketInList(state.list, ticket);
    const detail =
      state.detail?.id === ticket.id
        ? {
            ...state.detail,
            ...ticket,
            children: ticket.children ?? state.detail.children,
          }
        : (mergeCreatedChildIntoDetail(state.detail, ticket) ?? state.detail);
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return {
      ...state,
      list: enriched.list,
      detail: enriched.detail,
    };
  }),
  on(ticketBoardTicketRemoved, (state, { id, clientId }) => {
    const list = state.list.filter((t) => !(t.id === id && t.clientId === clientId));
    const clearDetail = state.detail?.id === id && state.detail.clientId === clientId;
    const detail = clearDetail ? null : state.detail;
    const selectedTicketId =
      clearDetail || (!state.detail && state.selectedTicketId === id) ? null : state.selectedTicketId;
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return {
      ...state,
      list: enriched.list,
      detail: enriched.detail,
      selectedTicketId,
    };
  }),
  on(ticketBoardCommentCreated, (state, { comment }) => {
    if (state.selectedTicketId !== comment.ticketId) {
      return state;
    }

    if (state.comments.some((c) => c.id === comment.id)) {
      return state;
    }

    return { ...state, comments: [...state.comments, comment] };
  }),
  on(ticketBoardActivityCreated, (state, { activity }) => {
    if (state.selectedTicketId !== activity.ticketId) {
      return state;
    }

    if (state.activity.some((a) => a.id === activity.id)) {
      return state;
    }

    return { ...state, activity: [activity, ...state.activity] };
  }),
);
