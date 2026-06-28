import type { ProjectTicketStatus } from '../../types/projects.types';

export const BOARD_LANE_STATUSES = ['draft', 'todo', 'in_progress', 'prototype', 'done'] as const;

export type BoardLaneStatus = (typeof BOARD_LANE_STATUSES)[number];

export function isTerminalTicketStatus(status: ProjectTicketStatus): boolean {
  return status === 'done' || status === 'closed';
}

export function isBoardLaneStatus(status: ProjectTicketStatus): status is BoardLaneStatus {
  return (BOARD_LANE_STATUSES as readonly string[]).includes(status);
}
