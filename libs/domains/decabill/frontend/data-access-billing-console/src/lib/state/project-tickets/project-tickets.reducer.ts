import { createReducer, on } from '@ngrx/store';

import type {
  ProjectTicketActivityResponse,
  ProjectTicketCommentResponse,
  ProjectTicketResponse,
} from '../../types/projects.types';

import { enrichTicketsWithSubtaskCounts } from './project-tickets-subtask-counts.utils';
import {
  addProjectTicketComment,
  addProjectTicketCommentFailure,
  addProjectTicketCommentSuccess,
  closeProjectTicketDetail,
  clearProjectTicketsError,
  createProjectTicket,
  createProjectTicketFailure,
  createProjectTicketSuccess,
  deleteProjectTicket,
  deleteProjectTicketFailure,
  deleteProjectTicketSuccess,
  loadProjectTicketDetailBundleSuccess,
  loadProjectTicketDetailFailure,
  loadProjectTickets,
  loadProjectTicketsFailure,
  loadProjectTicketsSuccess,
  openProjectTicketDetail,
  projectBoardActivityCreated,
  projectBoardCommentCreated,
  projectBoardTicketRemoved,
  projectBoardTicketUpsert,
  updateProjectTicket,
  updateProjectTicketFailure,
  updateProjectTicketSuccess,
} from './project-tickets.actions';

export interface ProjectTicketsState {
  projectId: string | null;
  list: ProjectTicketResponse[];
  selectedTicketId: string | null;
  detail: ProjectTicketResponse | null;
  comments: ProjectTicketCommentResponse[];
  activity: ProjectTicketActivityResponse[];
  loadingList: boolean;
  loadingDetail: boolean;
  saving: boolean;
  error: string | null;
}

export const initialProjectTicketsState: ProjectTicketsState = {
  projectId: null,
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

function mergeTicketInList(list: ProjectTicketResponse[], ticket: ProjectTicketResponse): ProjectTicketResponse[] {
  const idx = list.findIndex((t) => t.id === ticket.id);

  if (idx < 0) return [...list, ticket];

  const next = [...list];

  next[idx] = ticket;

  return next;
}

function mergeCreatedChildIntoDetail(
  detail: ProjectTicketResponse | null,
  created: ProjectTicketResponse,
): ProjectTicketResponse | null {
  if (!detail) return null;

  const parentId = created.parentId ?? null;

  if (!parentId || parentId !== detail.id) return detail;

  const prevChildren = detail.children ?? [];
  const withoutDup = prevChildren.filter((c) => c.id !== created.id);

  return { ...detail, children: [...withoutDup, created] };
}

export const projectTicketsReducer = createReducer(
  initialProjectTicketsState,
  on(loadProjectTickets, (state, { params }) => ({
    ...state,
    projectId: params.projectId,
    loadingList: true,
    error: null,
  })),
  on(loadProjectTicketsSuccess, (state, { tickets }) => {
    const { list, detail } = enrichTicketsWithSubtaskCounts(tickets, state.detail);

    return { ...state, loadingList: false, list, detail };
  }),
  on(loadProjectTicketsFailure, (state, { error }) => ({ ...state, loadingList: false, error })),
  on(openProjectTicketDetail, (state, { id }) => ({
    ...state,
    selectedTicketId: id,
    loadingDetail: true,
    detail: null,
    comments: [],
    activity: [],
    error: null,
  })),
  on(loadProjectTicketDetailBundleSuccess, (state, { ticket, comments, activity }) => {
    const { list, detail } = enrichTicketsWithSubtaskCounts(state.list, ticket);

    return { ...state, list, detail, comments, activity, loadingDetail: false };
  }),
  on(loadProjectTicketDetailFailure, (state, { error }) => ({
    ...state,
    loadingDetail: false,
    error,
    selectedTicketId: null,
  })),
  on(closeProjectTicketDetail, (state) => ({
    ...state,
    selectedTicketId: null,
    detail: null,
    comments: [],
    activity: [],
  })),
  on(createProjectTicket, (state) => ({ ...state, saving: true, error: null })),
  on(createProjectTicketSuccess, (state, { ticket }) => {
    const list = mergeTicketInList(state.list, ticket);
    const detail = mergeCreatedChildIntoDetail(state.detail, ticket);
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return { ...state, saving: false, list: enriched.list, detail: enriched.detail };
  }),
  on(createProjectTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(updateProjectTicket, (state) => ({ ...state, saving: true, error: null })),
  on(updateProjectTicketSuccess, (state, { ticket, activity }) => {
    const list = mergeTicketInList(state.list, ticket);
    const detail =
      state.detail?.id === ticket.id
        ? { ...state.detail, ...ticket, children: ticket.children ?? state.detail.children }
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
  on(updateProjectTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(deleteProjectTicket, (state) => ({ ...state, saving: true, error: null })),
  on(deleteProjectTicketSuccess, (state, { id }) => {
    const list = state.list.filter((t) => t.id !== id);
    const selectedTicketId = state.selectedTicketId === id ? null : state.selectedTicketId;
    const detail = state.detail?.id === id ? null : state.detail;
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return { ...state, saving: false, list: enriched.list, detail: enriched.detail, selectedTicketId };
  }),
  on(deleteProjectTicketFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(addProjectTicketComment, (state) => ({ ...state, saving: true, error: null })),
  on(addProjectTicketCommentSuccess, (state, { comment, activity }) => {
    const comments = state.comments.some((c) => c.id === comment.id)
      ? state.comments.map((c) => (c.id === comment.id ? comment : c))
      : [...state.comments, comment];

    return {
      ...state,
      saving: false,
      comments,
      activity: state.selectedTicketId === comment.ticketId ? activity : state.activity,
    };
  }),
  on(addProjectTicketCommentFailure, (state, { error }) => ({ ...state, saving: false, error })),
  on(clearProjectTicketsError, (state) => ({ ...state, error: null })),
  on(projectBoardTicketUpsert, (state, { ticket }) => {
    const list = mergeTicketInList(state.list, ticket);
    const detail =
      state.detail?.id === ticket.id
        ? { ...state.detail, ...ticket, children: ticket.children ?? state.detail.children }
        : (mergeCreatedChildIntoDetail(state.detail, ticket) ?? state.detail);
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return { ...state, list: enriched.list, detail: enriched.detail };
  }),
  on(projectBoardTicketRemoved, (state, { id, projectId }) => {
    const list = state.list.filter((t) => !(t.id === id && t.projectId === projectId));
    const clearDetail = state.detail?.id === id && state.detail.projectId === projectId;
    const detail = clearDetail ? null : state.detail;
    const selectedTicketId =
      clearDetail || (!state.detail && state.selectedTicketId === id) ? null : state.selectedTicketId;
    const enriched = enrichTicketsWithSubtaskCounts(list, detail);

    return { ...state, list: enriched.list, detail: enriched.detail, selectedTicketId };
  }),
  on(projectBoardCommentCreated, (state, { comment }) => {
    if (state.selectedTicketId !== comment.ticketId || state.comments.some((c) => c.id === comment.id)) {
      return state;
    }

    return { ...state, comments: [...state.comments, comment] };
  }),
  on(projectBoardActivityCreated, (state, { activity }) => {
    if (state.selectedTicketId !== activity.ticketId || state.activity.some((a) => a.id === activity.id)) {
      return state;
    }

    return { ...state, activity: [activity, ...state.activity] };
  }),
);
