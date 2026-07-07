import type { ListParams, ManualInvoiceLineItemDto } from './billing.types';

export type ProjectStatus = 'active' | 'archived';
export type ProjectTicketStatus = 'draft' | 'todo' | 'in_progress' | 'prototype' | 'done' | 'closed';
export type ProjectTicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectResponse {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  hourlyRateNet: number;
  targetHours?: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItem extends ProjectResponse {
  unbilledMinutes: number;
  openBillableAmountNet: number;
}

export interface PaginatedProjectsResponse {
  items: ProjectListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminProjectListItem extends ProjectListItem {
  userEmail?: string;
}

export interface PaginatedAdminProjectsResponse {
  items: AdminProjectListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProjectSummaryResponse {
  projectId: string;
  totalTrackedMinutes: number;
  unbilledMinutes: number;
  openBillableAmountNet: number;
  billedAmountNet: number;
  openTicketCount: number;
  doneTicketCount: number;
  milestoneCount: number;
  openMilestoneCount: number;
}

export interface AdminProjectDetailResponse extends AdminProjectListItem {
  summary?: ProjectSummaryResponse;
}

export interface CreateAdminProjectDto {
  userId: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
  hourlyRateNet: number;
  targetHours?: number | null;
  currency?: string;
}

export interface UpdateAdminProjectDto {
  userId?: string;
  name?: string;
  description?: string;
  status?: ProjectStatus;
  hourlyRateNet?: number;
  targetHours?: number | null;
  currency?: string;
}

export interface BillProjectTimeResponse {
  invoiceId: string;
  invoiceNumber?: string;
  billedMinutes: number;
  amountNet: number;
}

export interface BillProjectTimeDto {
  from: string;
  to: string;
  subscriptionId?: string;
  lineItems?: ManualInvoiceLineItemDto[];
}

export interface ProjectTimeReportRequestDto {
  from: string;
  to: string;
  unbilledOnly?: boolean;
}

export interface ProjectUnbilledTimeBoundsResponse {
  from?: string | null;
  to?: string | null;
  entryCount: number;
}

export interface AdminProjectsListParams extends ListParams {
  search?: string;
  userId?: string;
}

export interface ProjectTicketTasksDto {
  open: number;
  done: number;
  children: { open: number; done: number };
}

export const EMPTY_PROJECT_TICKET_TASKS: ProjectTicketTasksDto = {
  open: 0,
  done: 0,
  children: { open: 0, done: 0 },
};

export interface ProjectTicketSubtaskCountsDto {
  open: number;
  done: number;
}

export interface ProjectTicketResponse {
  id: string;
  projectId: string;
  parentId?: string | null;
  milestoneId?: string | null;
  title: string;
  content?: string | null;
  status: ProjectTicketStatus;
  priority: ProjectTicketPriority;
  shas: { short: string; long: string };
  tasks: ProjectTicketTasksDto;
  createdByUserId?: string | null;
  createdByEmail?: string;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
  children?: ProjectTicketResponse[];
  subtaskCounts?: ProjectTicketSubtaskCountsDto;
}

export interface CreateProjectTicketDto {
  parentId?: string;
  milestoneId?: string;
  title: string;
  content?: string;
  priority?: ProjectTicketPriority;
  status?: ProjectTicketStatus;
}

export interface UpdateProjectTicketDto {
  parentId?: string | null;
  milestoneId?: string | null;
  title?: string;
  content?: string | null;
  priority?: ProjectTicketPriority;
  status?: ProjectTicketStatus;
  locked?: boolean;
}

export interface ProjectTicketCommentResponse {
  id: string;
  ticketId: string;
  userId: string;
  userEmail?: string;
  body: string;
  createdAt: string;
}

export interface CreateProjectTicketCommentDto {
  body: string;
}

export interface ProjectTicketActivityResponse {
  id: string;
  ticketId: string;
  occurredAt: string;
  actorType: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actionType: string;
  payload: Record<string, unknown>;
}

export interface ListProjectTicketsParams {
  projectId: string;
  status?: ProjectTicketStatus;
  parentId?: string | null;
}

export interface ProjectMilestoneResponse {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  targetDate?: string | null;
  sortOrder: number;
  lockedAt?: string | null;
  progressPercent: number;
  openTicketCount: number;
  doneTicketCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectMilestoneDto {
  name: string;
  description?: string;
  targetDate?: string;
  sortOrder?: number;
}

export interface UpdateProjectMilestoneDto {
  name?: string;
  description?: string;
  targetDate?: string | null;
  sortOrder?: number;
}

export interface ProjectTimeEntryResponse {
  id: string;
  projectId: string;
  ticketId?: string | null;
  recordedByUserId: string;
  durationMinutes: number;
  description?: string | null;
  startedAt: string;
  endedAt: string;
  /** @deprecated Use startedAt */
  recordedAt: string;
  invoiceId?: string | null;
  billedAt?: string | null;
  createdAt: string;
}

export interface PaginatedProjectTimeEntriesResponse {
  items: ProjectTimeEntryResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateProjectTimeEntryDto {
  ticketId?: string;
  description?: string;
  startedAt: string;
  endedAt: string;
}

export interface UpdateProjectTimeEntryDto {
  ticketId?: string | null;
  description?: string | null;
  startedAt?: string;
  endedAt?: string;
}
